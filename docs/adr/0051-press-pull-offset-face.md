# ADR-0051: Press Pull and Offset Face

- **Status:** Accepted, 2026-09-30
- **Task:** P3-08, first half (FR-FT-08, FR-FT-12; Split body, Scale and Draft
  are the second half). Code: the facade's `offsetFaces` and `tangentFaces`
  (`packages/kernel/occt/facade/extrudo_facade.cpp`); `Kernel.offsetFaces`,
  `Kernel.tangentFaces`, `OffsetFaceError` (`packages/kernel/src/kernel.ts`);
  the definition `packages/core/src/offset-face.ts`; the evaluator
  `packages/kernel/src/features/offset-face.ts`; the dialog
  `apps/web/src/features/offset-face.ts`; the command
  `apps/web/src/features/pressPull.ts`; the unified proposal rule
  `apps/web/src/features/operation.ts`; the file format, `docs/file-format.md`
  6.18. **The facade changed** (OCCT input hash changed, see the changelog), no
  schema-version change, no migration; one new feature type.
- **Builds on:** ADR-0046 (shell: a facade modify feature that works on a copy,
  checks its result and diagnoses by bisection), ADR-0038 (fillet and the
  tangent chain), ADR-0005 (names), ADR-0027 (dialogs, pre-selection,
  manipulators), ADR-0028/-0029 (the press-pull proposal of extrude and
  revolve), ADR-0042 (the marking menu's Press Pull wedge), ADR-0047 (patterns).

## Context

FR-FT-08: Press/Pull is context-sensitive: on a face it offsets the face, on an
edge it fillets. FR-FT-12: offset face moves faces along their normals, the
neighbours following. The Press Pull wedge of the marking menu waited for the
command, and two carried-over items were due: patterns of faces (left out of
ADR-0047) and one press-pull proposal rule for extrude and revolve (open items
of ADR-0028 and ADR-0029).

Facts about OCCT 8.0.1 (read in `BRepOffset_MakeOffset.cxx`, then run in the
native harness on the pinned image, 570 cases over boxes, cylinders, cones,
spheres, tori, holed, L-shaped, filleted and cup-shaped bodies, every face, eight
distances from -30 to 30 mm, none of which trapped):

- `BRepOffset_MakeOffset` takes a **per-face offset** (`SetOffsetOnFace`) and
  accepts a global offset of 0: every face moves by its own value, and the
  faces that stay are offset by 0 and come back on the same surface. With the
  join kind `GeomAbs_Intersection` the offset faces are extended and
  intersected, so a slanted neighbour keeps its slope and gets longer or
  shorter (a box with a chamfer, top pulled 5 mm: the chamfer plane is
  extended, volume exact).
- `MakeThickSolid` (the `Thickening` flag) with the same settings returns
  only the **slab** between the faces and their offsets, not the body.
  `MakeOffsetShape` (no thickening) returns the body's new skin.
- The skin is a **solid for a plain body and a shell for most others** (a
  body with a hole, an L): it is closed into a solid by hand
  (`BRepBuilderAPI_MakeSolid`, reversed if its volume is negative).
- Every input face **generates** its offset face (`Generated`), and a face the
  offset swallows is **deleted**; nothing is `Modified`, so history works
  without any special case (`recordHistory` is a template over the builder
  type now).
- **A face is offset together with the faces that run smoothly into it** (angle
  under 4 degrees, OCCT's own tangent test): pulling the top of a block whose
  top edges are filleted moves the top, the four fillets and the four sides,
  by the same distance. Offsetting one face of a fully rounded box grows the
  whole box. OCCT does this by itself; it is Fusion's "tangent chain".
- **OCCT "succeeds" with junk**, as for shells: a cylinder's wall pushed in by
  more than its radius gives a valid solid of radius -2, a sphere or torus
  pushed too far a solid of negative volume, and cones and tori go through
  zero in between. `BRepCheck_Analyzer` and the volume's sign catch some; the
  rest shows in the distance from each moved face to its offset image, which
  must be at least the distance (a true offset surface is exactly that far
  from the original everywhere).
- A body with a sealed void (two shells) fails with `NotConnectedShell`.
- Unlike the shell, a face next to a fillet does **not** trap the heap: the
  tangent chain is offset whole, and the 570 cases, a 400-round loop with
  failures and probing, and the memory test are flat.

## Decision

### 1. One feature, `offsetFace`

Inputs (`OffsetFaceInputs`): `faces` (refs of kind `face`, at least one, of one
or several bodies) and `distance` (a length expression). **Positive moves a
face along its outward normal**: the body grows there, a hole's wall closes
in. Negative moves it in. A distance of 0 is an error ("nothing moves"), not
a warning: there is no other reading. One distance for all faces (see
rejected). The feature is a Modify feature, "Offset Face".

### 2. The facade builds it: `offsetFaces(shape, distance)`

The staged face indices each move by `distance` mm. The builder
(`BRepOffset_MakeOffset`) is on the C++ stack and works on a fresh
`BRepBuilderAPI_Copy` of the body, as the shell does (OCCT repairs its input in
place). History is recorded for input 0 by `recordHistory`. A result is good
when it is a valid solid; its volume has grown for a positive distance (and
shrunk for a negative one; moving faces outward only ever adds material,
holes included), within 1e-6 of the original; and the moved faces (the picks
and their smooth chain, `smoothClosure`) stay at least `0.999 |d| - 1e-3` from
their images. Non-solids are refused, and so are solids with more than one
shell.

On failure the facade **diagnoses** like the shell: it bisects the magnitude
of the distance (`largestThatWorks`, 7 steps on fresh copies) and returns
`[status, value]`: 1 too far (the largest distance that works), 2 none works, 3
not a solid, 4 a sealed void, 5 an OCCT exception. `Kernel.offsetFaces` throws
`OffsetFaceError` with `OffsetFaceProblem`s.

`tangentFaces(shape, face)` returns the faces of the smooth chain (the closure
of "shares an edge with normals within 4 degrees"), the face included, by
`lookupPtr`. `KernelApi.tangentChain` gained a `kind` (`edge` by default,
`face`) so the dialog's selection fields can follow face chains.

### 3. Names: every face keeps its name

The evaluator reads the facade's "generated" of a face as "modified"
(`facesKeepNames`), so every face carries its name through the offset, in both
directions and for every distance; a face OCCT splits gets `#n`, a swallowed
face is gone with its name. A fillet or a hole that refers to "the top face"
goes on finding it, and the distance is freely editable (tested with a fillet on
an edge of the moved face, distances 5, 12 and -8 mm). Edges and vertices are
named from the faces around them as always.

### 4. Messages

Worded in the evaluator, faces counted from 1, the maximum rounded down to two
digits so it works (as shell and fillet):

- "Face 6 can't move in by 25 mm: that is too far for this body (max ≈ 19 mm).
  Try a smaller distance." ("out" when pulling, "The faces" for several.)
- "... can't move in by 25 mm, or by any smaller distance. Check the faces
  around it."
- "Face 3 can't be offset, at any distance. Faces that run into fillets or other
  curved faces often stop this: try moving a flat face, or offset before
  rounding the edges."
- "This body has a sealed cavity inside, which Offset Face can't handle yet.
  Offset the faces before hollowing the body closed, or open the cavity with a
  shell."
- "The offset distance is 0 mm, so nothing moves. Enter a distance other than
  0." and "Pick a face to offset."

A lost face is a `LostReferenceError` (Fix References).

### 5. The dialog

`apps/web/src/features/offset-face.ts`: Faces (any face, flat or curved), and
Distance (default 2 mm). The field has `tangentChain`: picking a face brings the
faces that run smoothly into it, unpicking takes the chain out, and selected
faces are chained on opening, so the field shows what moves. The controller's
`followChain` handles faces as it does edges (the `DialogKernel.tangentChain`
call has a `kind`). A distance arrow stands on the first face along its outward
normal; for a curved face (whose mean normal is meaningless) `surfaceFrame`
puts it on a point of the surface near the centroid, with the normal there.
The live preview draws the result in place of the body.

### 6. Press Pull (`Q`) is a command, not a feature

`pressPull` is a tool (a Solid › Modify tile, the marking menu's wedge, Q,
Ctrl+K) that **opens the dialog that fits the selection**, with the
selection already in it (pre-selection, ADR-0027): a sketch **profile** opens
Extrude, a **face** of a body Offset Face, an **edge** Fillet; with several
kinds a profile wins over a face over an edge. With nothing usable selected it
says what to select (a toast) instead of starting anything. It is repeatable
("Repeat last" repeats Press Pull, not the dialog it opened). Only
`features/pressPull.ts` (`pressPullTarget`) knows the rule; `AppShell` runs the
target.

**Faces go to Offset Face, not to extrude's press-pull.** Extrude of a face
(E) sweeps the face as a prism and joins or cuts it: the faces around it stay
as they are, so a slanted neighbour is not extended (the new part has
vertical walls where the old faces lean) and a curved wall can't be pulled at
all. FR-FT-08 says "on a face it offsets the face". Extrude still does what
it did for the case where a prism is wanted, and its dialog keeps the
proposal rule.

### 7. One proposal rule for sweeps (`features/operation.ts`)

Extrude and Revolve propose their body operation through `proposeSweep(refs,
travel, doc)`: profiles of a sketch on an origin or construction plane make a
**new body**; a **face of a body**, or a **profile of a sketch on a body's
face** (P2-09), **joins** when swept out of the body (along the outward normal),
**cuts** when swept into it, and joins when swept both ways; nothing is
proposed while the way isn't known. The two dialogs only say which way: extrude
from the sign of the distance, Flip and the extent (`extrudeTravel`); revolve
from the direction side 1 starts turning at the profiles' centre,
`axis × (centre − foot)`, reversed by a negative angle (`revolveTravel`).
Symmetric, two-sided and whole-turn revolves go both ways and join. A revolve
with no axis yet, or a face square to the axis, keeps proposing the join it
always did. So **a face turned into its body proposes a cut, a face turned out
of it a join, and a profile drawn on a face follows its face**, in both
dialogs. `isOnBody` is the one test of "belongs to a body".

### 8. Patterns of faces: not done

They don't fall out of Offset Face. A pattern of *features* already repeats an
extrude, revolve, primitive or hole that joins or cuts; what a face pattern
would add is repeating a **face offset** (the same pad at another place), which
is a feature repeat of an offset whose faces are chosen per instance: the faces
of a pattern instance have their own names, but an offset that moves a face
picked by name can't be replayed at a different place without a mapping from the
original's faces to the instance's (the `pattern:<id>:<label>:from:(...)` names
give it, but `replayFeatures` only knows tools, not faces). See the open items.

## Alternatives rejected

- **Extrude the face and join or cut** (what press-pull did for faces). Leaves
  the neighbours alone (no extension of slanted or curved neighbours), can't
  change a cylinder's radius, and makes a prism that has to be fused by a
  boolean, which costs time and names. Kept as Extrude's press-pull.
- **`MakeThickSolid` for the moved faces only.** It gives the slab between the
  faces and their offsets, not the body.
- **`BRepOffsetAPI_MakeOffsetShape`.** It takes one global offset and has no
  `SetOffsetOnFace`; `BRepOffset_MakeOffset` is what it wraps.
- **Refusing a face that runs into a fillet** (the shell's rule). Offset moves
  the chain as a whole without trapping, and the pad-with-rounded-edges is the
  commonest case. The chain is made visible in the dialog instead.
- **A different distance per face** (`SetOffsetOnFace` allows it). The
  requirement and Fusion have one distance; a second field per face set would
  need sets like fillet's. A later addition.
- **Press Pull as a feature type of its own**, storing which feature it was.
  The document should say what was built: an Offset Face, a Fillet, an Extrude,
  each with its own editable dialog and timeline chip.
- **Press Pull with nothing selected as a picking mode** (click a face or edge
  to start). It would need a second mode on top of the selection tools;
  select-then-Q is the rule Fusion users know, and the toast tells.
- **One rule per dialog for the proposal** (what there was). They had drifted: a
  revolved face always joined, a profile on a face only followed extrude.

## Open items

- **Patterns of faces** (FR-FT-11): see 8. Replaying an offset at each instance
  needs faces mapped through the pattern's names.
- **A distance per face or per set**, and Fusion's "offset face" options
  (a tangent chain switch, extend or keep the neighbours' shape: here every
  chain moves together and neighbours always extend).
- **Solids with a sealed void** (a body hollowed closed) can't be offset:
  OCCT wants one connected shell. Offsetting the shell that holds the picked
  faces and rebuilding the solid is the way.
- **A face moved into another part of the same body** (an L's inner corner
  pushed through the other leg) can produce a valid but self-intersecting
  solid that `BRepCheck_Analyzer` passes; only the volume and distance tests
  stand in the way. A `BOPAlgo_ArgumentAnalyzer` self-intersection check would
  close it, at a cost on every preview.
- **The distance arrow on a whole curved wall** sits on one point; dragging a
  cylinder's wall by its arrow isn't special in any way.
- **Press Pull on a body, a vertex or a construction plane** does nothing
  beyond the prompt; on a body it could move the body (Move), on a construction
  plane its offset.
- **Extrude's own press-pull** (E on a face) remains; whether it should be
  removed from the dialog's prompts is a UX question for the owner.
