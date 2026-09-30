# ADR-0044: Combine, Move/Copy and Mirror

- **Status:** Accepted, 2026-09-30
- **Task:** P3-06 (FR-FT-09, FR-FT-10, FR-FT-11 mirror). Code: the facade's
  `transform` (`packages/kernel/occt/facade/extrudo_facade.cpp`),
  `Kernel.transform` (`packages/kernel/src/kernel.ts`), the matrices
  (`packages/kernel/src/features/matrix.ts`); the definitions
  `packages/core/src/combine.ts`, `move.ts`, `mirror.ts`; the evaluators
  `packages/kernel/src/features/combine.ts` and `transform.ts` (Move and
  Mirror); the dialogs `apps/web/src/features/combine.ts`, `move.ts`,
  `mirror.ts` and the tools in `shell/tools.ts` (a Transform group in the
  Solid tab; `M` is Move in the model).
- **Builds on:** ADR-0001 (the facade owns OCCT memory), ADR-0005 (names
  carried through history), ADR-0024 (the engine, shape scopes, leak checks),
  ADR-0027 (dialog fields, manipulators), ADR-0028/0029 (`splitSolids`, body
  operations), ADR-0030 (bodies), ADR-0040 (`planeOf`, `lineOf`, `pointOf`).
- **Affects:** P3-07 patterns (a pattern of bodies is a series of `transform`s
  with the same naming), P3-10 place on bed (a Move), P3-14 (B4 to B7 use
  mirror and combine).

## Context

Three features that work on whole bodies and have nothing in common but that:
the two-body boolean (Combine), rigid motion (Move/Copy with a gizmo) and
reflection (Mirror). B3 also had a join extrude standing in for a real
Combine (ADR-0039). Rigid motion and reflection needed a kernel operation,
and it had to keep every persistent name (ADR-0005) so that a fillet or a
sketch made on a face of a body still finds it after the body moved.

## Decision

### 1. One facade method, `transform`, with a 3 × 4 matrix

`transform(shape)` takes the 12 numbers of a matrix (row-major, translation
last) staged with `clearNumbers`/`pushNumber`, builds a `gp_Trsf` with
`SetValues`, rejects a scale (`|ScaleFactor| != 1`), runs
`BRepBuilderAPI_Transform(shape, trsf, copy = true)` and records history for
input 0 with the same `recordHistory` the booleans use: every face, edge and
vertex is `modified` into its image. One call covers translation, rotation,
reflection and any composition of them, so Move's "turn, then move" is one
operation with one history. The TypeScript side builds the matrices
(`matrix.ts`: `translation`, `rotation` about a line by Rodrigues,
`mirror` in a plane, `compose`), which are pure and unit-tested.

`copy = true` matters: without it OCCT gives a rigid transform a *location*
(`Moved`), the result shares geometry with the input, `Modified` returns the
moved input, and locations pile up over a chain of moves. A mirror can't be
a location at all (`TopoDS_Shape::Move` refuses a negative scale). Rebuilding
the geometry gives an ordinary shape that later booleans, fillets and the
mesher treat like any other, and the facade's memory rules hold: the builder
is on the C++ stack, and the native harness shows the heap flat over 1500
transform, mesh and release rounds (also `memory.test.ts`, with a fuse of a
mirrored copy).

Checked natively on the pinned image before CI: translation, rotation about
Z and an oblique axis, mirror; every result valid, volume and box right (a
mirrored solid has positive volume and outward faces), a scale and a null
matrix fail with a message, 26 history records of 7 numbers for a box,
meshing a transformed shape whose source was meshed gives the moved mesh.

### 2. Names follow through history; copies get names of their own

`withHistory` names a transformed body from the input's table: faces keep
their names (`modified` keeps the source's name), and edges and vertices are
derived from them, so a move or a mirror in place changes no name. A test
fillets an edge by the name it had before a move (with a turn) and gets
the same faces.

A **copy** with the original's names would make every name mean two faces in
two bodies. The resolver (`resolveRef`) then finds two exact matches and has
to guess by fingerprint, with a warning (found by the first mirror test: a
fillet on the copy's edge warned). So a copy's faces are renamed
`<op>:<feature>:from:(<original name>)` (`createdName`, the form fillet faces
already have) and its edges and vertices derived again. Copies of different
bodies can't clash, and a later feature's reference to a copy's face is
exact.

### 3. Combine is strict, explicit and works on bodies by ID

`combine` has a `target` (one body ID), `tools` (body IDs), `operation`
(`join` default, `cut`, `intersect`) and `keepTools`. The result takes the
target's ID; tools are removed from the body set unless kept. Booleans go
through `namedBoolean` (faces of the target keep their names, tool faces in
the result keep theirs, merged faces keep the target's).

- **Join** fuses tools as they are reached, in any order, each having to
  touch what has been joined so far (a chain target-A-B works with the tools
  listed as B, A). A tool that touches nothing is an error, not a silent new
  body: unlike an extrude, Combine names its participants, and "these two
  don't touch" is the useful message.
- **Cut** subtracts each tool; **intersect** takes what the target shares
  with the tools *together* (the tools are fused first: the same reading as
  cut, where the tools together are what is taken away).
- A cut that removes nothing or everything, and an intersection with nothing
  left, are errors with a message ("The tool bodies don't overlap the target,
  so the cut removes nothing").
- Several separate solids in the result become one body per solid
  (`splitSolids`, ADR-0030).
- The dialog's preview draws the tool bodies in the operation's style
  (`previewTools`: join and intersect translucent, cut red).

### 4. Move/Copy: three modes, one gizmo

`move` has `bodies`, `mode` and a `copy` toggle.

- **`free`** (default): `rx`, `ry`, `rz` turn the bodies about the world
  X, Y and Z axes through the **centre of their bounding box** (the exact,
  tight box of the kernel's `properties`), in that order, then `dx`, `dy`,
  `dz` move them.
- **`rotate`**: `angle` right-handed about an `axis` (an origin or
  construction axis, a straight edge, a sketch line: `lineOf`).
- **`point-to-point`**: the vector from a `from` to a `to` point (vertices
  or construction points: `pointOf`).

A move that moves nothing is a *warning* ("Nothing moves"), not an error: a
parameter can hit 0 legitimately, and a new dialog starts at 0.

The **gizmo** is the framework's manipulators (ADR-0027), no new overlay
code: in `free` mode an arrow per axis (starting on the box face the axis
points out of, so the three handles never coincide) and an angle ring per
axis at the box centre (their start on the diagonals between the arrows);
in `rotate` mode one ring about the picked axis, starting on the bodies'
side; `point-to-point` has none. Dragging writes the field, which stays an
`<ExpressionInput>` (a drag replaces the expression, as ADR-0027 says).
The pivot the view draws is the centre of the meshes' box, the kernel's the
tight box of the shapes: the same to a fraction of the tessellation error.

### 5. Mirror

`mirror` has `bodies`, a `plane` (origin plane, construction plane or flat
face, through `planeOf`, picked with Create Sketch's plane picker), `copy`
(default **true**) and `join` (only with copy). A copy adds bodies
`<feature>:<n>`; without copy the bodies are mirrored in place and keep their
IDs. `join` fuses each copy into its original with `simplify`, so the faces
in the plane disappear; a copy that doesn't touch its original stays a body
of its own with a warning.

**Mirroring features is not built.** Replaying features about a plane means
re-evaluating their inputs (sketch planes, distances, references) in a
mirrored frame, which is what the pattern features (P3-07, "of features")
need anyway; doing it twice would be worse than doing it once. FR-FT-11's
"and of features if it fits" doesn't fit here: mirror of bodies covers the
symmetric-part workflow (model half, mirror, join), and P3-07 will carry
features for both.

## Rejected

- **Locations (`TopLoc_Location`) instead of a facade call.** No facade
  change at all for translation and rotation (the facade's `prism` already
  shifts that way), but a mirror can't be a location, history of `Moved` is
  the identity, moved shapes carry chains of locations through every later
  operation, and two code paths (moves and mirrors) would name differently.
  One rebuilt-geometry call is simpler and costs one OCCT hash.
- **Separate facade methods per motion** (`translate`, `rotate`, `mirror`).
  Three history-recording methods for what a matrix expresses; a composed
  Move would be two calls and two histories to chain.
- **A `mode` code plus numbers in the facade** (translate, rotate about an
  axis, mirror in a plane): the facade would repeat the maths the TypeScript
  side does and tests better.
- **Pivot for `free` turns at the world origin, or a stored pivot.** The
  origin makes a turn fling a distant body around; a stored pivot is three
  more expressions nobody edits. The box centre is where Fusion's gizmo
  starts and needs nothing stored.
- **Three rings in `rotate` mode** (one per world axis, as in `free`): they
  would be the same three fields again. `rotate` is for an axis somewhere
  that isn't a world axis.
- **Copies keeping the original's face names.** Simplest, and ambiguous
  (section 2).
- **Combine that silently makes a new body when a joined tool doesn't
  touch**, like extrude's join: hides a mistake the user can fix by moving
  one body.
- **Intersect with several tools as "with each in turn"**: the empty result
  after a disjoint pair is not what "the part shared with the tools" means.

## Consequences

- OCCT input hash `8057072e8cdd` with chamfer (`6e7b034fedff` before the
  rebase onto it; one new facade method and its include);
  the WASM is 19 KB bigger raw (15.79 MB, was 15.77 with the fillet).
- `benchmark-b3.spec.ts` builds the stand with Combine1 instead of the strip
  (Sketch3, Extrude3): five features, the base and the rest in one body of
  volume `60·80·10 + 60·10·60`. The fixture was rewritten
  (`WRITE_FIXTURES=1`) and `benchmarks.test.ts` checks it rolled back before
  the Combine (two bodies) and after.
- Body selection before a dialog fills fields in order: Combine takes the
  first selected body as its target and the rest as its tools.
- The toolbar has a Transform group (Move, Mirror, Combine) in the Solid tab,
  so the shell screenshots changed.
- Open: no drag handles on point-to-point; a `free` move's turns don't show
  the pivot; Move has no "Repeat"; features can't be mirrored (P3-07); a
  mirror of a body about a face of itself isn't special-cased (it works when
  the face is flat).
