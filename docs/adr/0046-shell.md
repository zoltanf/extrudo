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
- **Removing a face that runs smoothly into a neighbour** (any face of a
  box whose 12 edges are all filleted, or a face next to a fillet) makes
  the offset fail, and for some of them it traps: `BRepOffset_Tool::ExtentFace`
  runs into `Approx_SameParameter` and the WASM dies with `RuntimeError:
  memory access out of bounds` inside `malloc`/`free` (not an exception, so
  nothing can catch it). Which call traps depends on what ran before, so the
  heap is corrupted earlier; the same calls in another order passed. A shell
  with **no** removed face of the same body is fine (tested with every
  fillet), and so is removing a face whose neighbours are all at a crease.
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

- The facade has a new method `shell` beside P3-06's `transform`; the
  combined OCCT input hash is `6384f5ae452a` (built by CI on branch
  `p3-03-shell`, rebased on P3-06).
- The Shell tile is enabled. The shell screenshots (dark and light) passed
  unchanged in CI, so no baseline was regenerated; `shell.spec.ts`'s "not
  built yet" test now uses Place on Bed (P3-10).
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

## Amendment (P4-12, 2026-10-06): a thickness per face, and openings next to a fillet

Two items of the P4-12 backlog: "Shell: a thickness per face; removing faces
next to a fillet". Prototyped natively first (`spikes/p4-12-shell-faces/`:
`run.sh` builds `harness.cpp` over the facade in the pinned image; `run.sh`
alone prints the volume table below, `run.sh sweep` and `run.sh sweep2` are
the trap sweeps, one node process per case, `DEBUG=1`, `MALLOC=…` and
`OPT=…` choose the build).

### Decisions

1. **Wall sets.** The shell takes up to `SHELL_MAX_WALLS` = 8 numbered sets in
   ADR-0038's manner: `wallFaces` + `wallThickness`, `wallFaces2` +
   `wallThickness2` … (`shellWallFacesKey`, `shellWallThicknessKey`,
   `shellWallSets` in core; `shellInputs`' `walls` option). Each set's faces
   get its thickness instead of `thickness`. A set with no faces does
   nothing, so a document without sets reads and computes exactly as before
   (no schema-version change). The evaluator refuses, worded for the user: a
   set with faces and no thickness, a thickness ≤ 0, a face of a body this
   shell doesn't hollow, a removed face in a set, a face in two sets.
2. **The facade: `clearWalls()`, `pushWall(face, thickness)` and
   `shellFaces(shape, thickness, outside)`.** The removed faces are staged
   with `pushArg` as for `shell`, the walls with `pushWall` (the facade's
   existing staging style: a clear and a push per item, read by the call).
   `Kernel.shell(shape, faces, thickness, side, walls)` calls `shellFaces`
   only when there are walls; `shell` is unchanged for every other shell.
   `shellFaces` runs `BRepOffset_MakeOffset` directly (what
   `BRepOffsetAPI_MakeThickSolid` wraps: `Initialize`, `AddFace` per removed
   face, `SetOffsetOnFace` per wall, `MakeThickSolid`) on a copy, and checks
   its result like `shell` (a solid, `BRepCheck_Analyzer`, a positive volume,
   smaller inwards) with the distance test **per thickness** (each group of
   faces at least its own thickness from its offsets) and over all faces (at
   least the thinnest). Its history is the builder's (its `Modified` of a
   closing face is the API's), so `nameShell` names it unchanged: the outer
   skin keeps the original names, the cavity is `shell:<id>:inner:(<face>)`,
   the rim `shell:<id>:rim:(<face>)` — adding a wall set renames nothing.
3. **Sharp joins with wall sets.** With `GeomAbs_Arc`, OCCT's
   `UpdateFaceOffset` spreads a face's own offset over every edge where the
   offsets diverge (convex edges outwards, concave ones inwards): a box shelled
   outwards with a 4 mm floor came out 4 mm thick all round (10,145 mm³
   instead of 5,824), an L's inner step spread to the wall above it. With
   `GeomAbs_Intersection` (Offset Face's join, ADR-0051) it spreads over smooth
   edges only, and every case of the table is exact. So **a shell with wall
   sets joins its walls sharp**: outwards its corners are square instead of
   rounded, inwards a concave edge's wall is thicker at the corner (an L's
   inner corner: 7,472 mm³ against round joins' 7,458). A shell without sets
   keeps round joins.
4. **Smooth chains take one thickness.** OCCT offsets the faces that run
   smoothly into a set's face (its smooth chain, `smoothChains`, ADR-0051) by
   the set's value, so the facade does too (`wallThicknesses`), the check uses
   it, and two sets that reach one chain with different thicknesses are
   refused (status 10, "Face 7 runs smoothly into a face with another wall
   thickness…"). The dialog's Wall faces fields have `tangentChain`, so a pick
   shows the chain. A body where a smooth chain has a sharp edge inside it is
   refused before OCCT runs (status 7), as Offset Face refuses it: the per-face
   offset is the call ADR-0051 found trapping on such bodies.
5. **Diagnosis**: a failing `shellFaces` bisects one factor every thickness
   (the shell's and the walls') is scaled by together, `[1, factor]`, worded
   "Walls of 2 mm, 25 mm are too thick for this body (max ≈ 1.5 mm, 19 mm, all
   scaled together). Try thinner walls." Statuses 8 (a wall is a removed face)
   and 9 (a face with two thicknesses) back up the evaluator's own checks.
6. **Openings next to a fillet: plugs.** See "The trap" below: the refusal of
   a removed face tangent to a neighbour was made for a trap that doesn't
   reproduce, and OCCT can't open such a face anyway. What it does build is
   the body **hollowed closed**. So when a removed face runs smoothly into a
   neighbour (`openingRoute`), both `shell` and `shellFaces` hollow the body
   closed (round joins for `shell`, sharp ones with wall sets) and cut each
   removed face's **plug** out of it (`buildPlugged`, `plugShell`): the face's
   prism, from half a wall outside the face to half a wall past the wall's
   inner side, in common with the cavity moved out along the face's normal by
   two walls, so the plug keeps to the cavity's own outline — at a tangent
   edge the face's outline (the round below it is concentric), at a square
   edge the inner side of the neighbouring wall. Inwards the cavity is the
   skin's inside, outwards the body itself. This is a plain boolean, valid and
   exact (the table), and its history (`recordPlugged`) is the closed hollow's
   carried through the cut, with each removed face *modified* into what its
   plug leaves, so the opening's walls are `shell:<id>:rim:(<face>)` like any
   rim. The rule for a plug (`pluggable`): **the face is flat, each of its
   edges meets a neighbour smoothly or square (within 1e-3 of 90°), and no two
   removed faces share an edge** (two plugs would leave the bar between them).
   Anything else stays refused before OCCT runs (status 6), with the message
   now saying what an opening needs. A body whose fillet is thinner than the
   wall fails like its closed hollow does and reports the largest wall that
   works (a 1 mm round takes walls under 0.99 mm).
7. **A wall that reaches through the body is not built** (`wallsPassThrough`):
   the memory test found OCCT's per-face offset with sharp joins leaking about
   9 kB per build exactly when a flat face's inward wall is at least as deep
   as the body behind it (a 40 mm wall on a 40 mm plate leaks, 39 mm doesn't;
   round joins and Offset Face's too-far offsets don't), building a valid junk
   solid the checks then refuse. No such wall can work, so `shellFaces`, its
   probes and a plugged shell with wall sets treat it as a failed build before
   OCCT runs: the depth is bounded by the body's box and, for a wall past half
   of that, measured exactly (the body's distance from a plane beyond it). The
   memory test's wall-set round (wall sets inside, outside and closed, a plug
   inside and outside, a wall too thick with its probes, a wall on a removed
   face) then stays flat over 300 rounds; before, it stepped 16 MiB every
   550 rounds.
8. **The dialog** (`apps/web/src/features/shell.ts`): under Direction, "Wall
   faces" (prompt "Pick faces for another thickness") and, once it has faces,
   "Wall thickness" (default 4 mm); set n + 1 shows once set n has faces, as
   fillet's sets. The dialog's validation names a removed face in a set and a
   face in two sets before a preview runs. Mesh bodies are refused as before
   (`#solid`).

### The trap (ADR-0046 Context): what was found

ADR-0046 saw `RuntimeError: memory access out of bounds` inside
`malloc`/`free` while removing a face next to a fillet, under
`BRepOffset_Tool::ExtentFace` → `Approx_SameParameter`, depending on what ran
before. Rebuilt with `-g2`, the shell **without the refusal** (the facade's
whole path: build, check, and the seven-step bisection on failure) ran on
rounded boxes (all twelve edges at r = 1, 3, 5 mm; one top edge at 3 and
5 mm; the four vertical edges at 3 mm), cylinders with a rounded rim (r = 2,
4 mm), every face, walls of 0.5 to 4 mm:

- one case per process (`sweep`, raw `MakeThickSolidByJoin`, 130 cases),
- in sequence in one process (`useq`, 112 and 302 cases, about 3,000 builds
  with the probes), with Emscripten's dlmalloc at `-O1` and with **mimalloc at
  `-O3`**, which is what the real build links (CLAUDE.md),
- and under **`emmalloc-memvalidate`**, which checks the whole heap at every
  allocation and stops at the first damaged block (six cases, 48 builds).

**None trapped and the validator found no damage.** OCCT 8.0.1 never built a
valid shell with such a face removed either: every result was either invalid
(`BRepCheck_Analyzer`) or the body handed back unchanged (`NbOF == NbF`), and
the bisection found no thickness that worked. So the trap of P3-03 is not
reproducible on the current OCCT and facade (most likely it came from an
earlier prototype that offset the cached body in place — the copy for every
build arrived with the same ADR — but that can't be shown now), and refusing
these faces cost nothing a build could have given. The refusal is **kept** for
the faces plugs can't open — a crash in the worker is still the worse failure,
and there is nothing to gain from trying — and those faces are now only curved
ones, slanted neighbours and removed faces that touch. The plug route itself
was swept the same way (`sweep2`: every flat tangent face of the bodies
above and of boxes with only their top edges rounded at 3 and 5 mm, walls 0.3
to 6 mm, through the facade, one process each, 238 cases): no trap; 150 built
and the other 88 reported the largest wall that works (a wall at or past the
round's radius).

### Results (`bash spikes/p4-12-shell-faces/run.sh`; 20 mm cube unless named)

| Case | Volume mm³ | Exact | Faces |
|---|---|---|---|
| top removed, 2 mm, floor 4 mm | 3904.000 | 8000 − 16·16·16 | 11 |
| top removed, outside 2 mm, floor 4 mm (sharp) | 5824.000 | 24³ − 8000 | 11 |
| top removed, floor 4, front 3 | 4160.000 | 8000 − 16·15·16 | 11 |
| top removed, 2 mm, floor 1 mm | 3136.000 | 8000 − 16·16·19 | 11 |
| closed, 2 mm, top 4 mm | 4416.000 | 8000 − 16·16·14 | 12 |
| closed, outside 2 mm, top 4 mm | 6976.000 | 24·24·26 − 8000 | 12 |
| cylinder r 10, top removed, 2 mm, floor 5 mm | 3267.256 | π(2000 − 64·15) | 5 |
| cylinder r 10, closed, 2 mm, both ends 4 mm | 3870.442 | π(2000 − 64·12) | 6 |
| cylinder r 10, top removed, wall 3, floor 2 | 3512.301 | π(2000 − 49·18) | 5 |
| cylinder r 10, top removed, outside 2, floor 5 | 5026.548 | π(144·25 − 2000) | 5 |
| vertical edges r 3, top removed, 2, floor 4 | 3763.221 | exact | 19 |
| vertical edges r 3, top removed, 2, sides 2.5 (the ring's chain) | 3799.350 | exact | 19 |
| vertical edges r 3, top removed, outside 2, floor 4 | 5463.469 | exact | 19 |
| all edges r 3, closed, 2, top 2.5 (its chain is the whole body) | 4207.109 | exact | 52 |
| L (40·20·10 + 10·20·30), end removed, 2, step 4 | 8432.000 | exact | 15 |
| all edges r 3, top removed, 0.5 / 2 / 2.9 (plug) | 900.501 / 3124.484 / 4141.296 | exact | 54 |
| all edges r 3, top removed, outside 2 (plug) | 4481.652 | exact | 54 |
| one top edge r 3, top removed, 1 (plug) | 1856.823 | exact | 20 |
| one top edge r 3, top removed, 1, floor 4 (plug) | 2828.823 | exact | 20 |
| cylinder, rim r 2, top removed, 1 (plug) | 1461.990 | exact (Pappus) | 7 |

Every row matches its exact volume to within 1e-15 relative. A floor of 25 mm
in a 20 mm cube reports the factor 0.797; two sides of one rounded ring at 2.5
and 3 mm, a removed face in a set, a face in two sets, a body with only its
top edges rounded given a wall set, a rounded edge's own face and two touching
removed faces are refused before OCCT runs. A shell with wall sets takes 20 to
200 ms in the harness, a plugged one 50 to 400 ms (a fully rounded box).

### Consequences

- The facade has `clearWalls`, `pushWall` and `shellFaces`, and `shell` takes
  the plug route; the OCCT input hash is `2b4714e5b37a` (built by CI on branch
  `p4-12-shell-faces`), the WASM 18.80 MB raw, 4.26 MB brotli (about 30 kB
  more).
- Documents that had a removed face next to a fillet refused now compute when
  the face is flat with square or smooth edges: an error turns into a shell.
  Every other shell document computes exactly as before (the golden table only
  gained rows).

### Rejected

- **Removing the face's whole smooth chain** (Offset Face's `tangentFaces`):
  on a rounded box the chain is the whole body, and on a box with one rounded
  edge it opens the front as well as the top.
- **Round joins with wall sets**: they spread a set's thickness across
  diverging edges (decision 3), which a check can only refuse.
- **The plug as the face's prism alone**: at a square edge it cuts the
  neighbouring wall's top away (one top edge rounded: 1,778.8 mm³ instead of
  1,856.8), hence the common with the moved cavity.
- **Lifting the refusal of tangent faces** without plugs: OCCT builds nothing
  there (see "The trap"), so it would only add eight failing builds to every
  preview.

### Open

- Plugs through a **curved** face or past a **slanted** neighbour, and two
  removed faces next to a fillet that share an edge.
- Round joins with wall sets: a fillet of the outside corners after the shell
  does it today.
- A handle per wall set in the view.
