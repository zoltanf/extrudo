# ADR-0064: Rib and variable-radius fillet

- **Status:** Implemented, 2026-10-04 (branch `p4-10-rib-fillet`)
- **Task:** P4-10 (FR-FT-17 "Rib / web"; FR-FT-04 "Variable radius comes
  later").
- **Builds on:** ADR-0028 (extrude: `namedPrism`, `operate`, `splitSolids`,
  `previewTools`), ADR-0029 (a sketch line as a reference, placed by
  `SketchOutputData.frame` and `.lines`), ADR-0038 (fillet: sets, chains, the
  diagnosis), ADR-0047 (patternable features).

## Context

A rib (a gusset, a web) is a thin wall that fills the space between a sketch
line and the body: in an L-bracket, a diagonal line on the bracket's midplane
becomes a triangular stiffener that meets both legs. Fusion and SolidWorks build
it from an **open** sketch curve, a thickness about the sketch plane and a
direction in the plane; the material stops where it meets the body.

Variable-radius fillets are the remaining part of FR-FT-04. OCCT's
`BRepFilletAPI_MakeFillet::Add(R1, R2, edge)` rounds a whole tangent chain with a
radius that changes linearly from R1 at the chain's first vertex to R2 at its
last. The facade's `fillet` stages one radius per edge.

## Decision

### 1. Rib: a feature `rib`, no facade change

`packages/core/src/rib.ts`, inputs (plain inputs with defaults):

| Input | Kind | Default | Meaning |
|---|---|---|---|
| `curve` | ref | (required) | one sketch **line** (`{kind:'sketchEntity', id:'<sketch>/<line>'}`, as revolve's axis takes one) |
| `thickness` | expr (length) | `2 mm` | the wall's thickness, > 0 |
| `side` | enum `both` / `one` / `other` | `both` | about the sketch plane: centred, along its normal, against it |
| `flip` | boolean | `false` | grow to the other side of the line |

Kernel (`packages/kernel/src/features/rib.ts`), all with existing calls:

1. The line in world coordinates from the sketch output (frame + `lines`), its
   unit direction `u`, the plane normal `n`, and the in-plane direction `d = n ×
   u`, signed **towards the body** (the side of the line where the centre of
   the bodies' box lies; `flip` reverses it).
2. `L` = the bodies' box diagonal (plus the line's length). A planar face in the
   sketch plane: the line **extended by `L` at both ends**, swept by `L` along
   `d` (a long rectangle that starts at the line). Prism it along `n` by the
   thickness (`side`: −t/2…t/2, 0…t or −t…0) with `namedPrism`: the **slab**.
3. Cut every body out of the slab (`namedBoolean` cut): the slab falls into
   pieces. The rib is the piece that holds the point `m + ε d` (the line's
   midpoint moved a hair into the material side, at mid-thickness; ε = 1e-4 ×
   L), found with the exact distance (0 = inside or on). Errors:
   - that point lies inside a body: "The rib's line lies inside the body.";
   - no piece holds it, or the piece reaches the slab's far side or ends (its
     box touches the slab's box on the far `d` side or at either end of the
     extended line, within 1e-6 × L): "The rib doesn't close against the body:
     make the line's ends reach it, or flip the rib.".
4. `operate` join of that piece into the bodies it touches (`touchingBodies`),
   `splitSolids`; the piece is the feature's `previewTools`, so the dialog
   previews it and patterns can repeat it (`repeatableFeatures` counts a rib as
   a join).
5. Names: the slab's prism names under `rib:<id>` (sides after the sketch line
   and the extension's ends, caps `start`/`end`) carried through the cut and the
   join by history, as extrude's are.

Dialog `apps/web/src/features/rib.ts`: tool `rib` in Solid › Create's menu after
Emboss, no key. Fields: Line (selection of one sketch line, like revolve's Axis
field accepting sketch lines), Thickness (expression, with a distance manipulator
across the plane), Thickness side (choice), Flip (toggle; an arrow manipulator
showing `d`).

**Only straight lines in this task.** An open chain of lines and arcs needs the
extension rule per end and the in-plane "towards the body" for every piece;
deferred.

### 2. Variable-radius fillet: an end radius per set

Core (`packages/core/src/fillet.ts`): each set `n` gets two more optional inputs,
`radiusEnd<n>` (expr, length; set 1 `radiusEnd`) and `swap<n>` (boolean; set 1
`swap`), keys from `filletEndKey(n)` / `filletSwapKey(n)`. A set with an end
radius is **variable**: the radius goes from `radius<n>` at its chain's start to
`radiusEnd<n>` at its end; `swap<n>` exchanges the ends (which end OCCT calls the
start depends on the topology, so the dialog shows it and the user swaps). Without
`radiusEnd<n>` nothing changes. The schema stays: plain inputs (no
`docs/file-format.md` change beyond listing them in the fillet section).

Facade: a new method `filletVariable(shape)`: staged edges (`pushArg`) and **two**
staged numbers per edge (R1, R2; equal for constant sets); `Add(R1, R2, edge)`
for each staged edge that isn't in a contour yet (`Contour(edge) == 0`), then the
same build, `BRepCheck_Analyzer` check and history as `fillet`. On failure the
diagnosis is the scale factor of `fillet`'s status 4 (the largest factor all radii
can be multiplied by, by bisection, `largestThatWorks`), else status 5; a chain
staged with two different (R1, R2) pairs is status 3 as now. **`fillet` itself is
unchanged**: the evaluator calls `filletVariable` only when some set is variable,
so existing documents compute exactly as before. `Kernel.filletVariable` throws
`FilletError` like `Kernel.fillet`.

Dialog: each set gets a "Variable" toggle (not an input: shown on when the set has
an end radius), and when on, "End radius" and "Swap ends"; the preview shows the
change. Fillet faces keep their names (`fillet:<id>:from:(<edge>)`).

**OCCT build:** the facade change needs a new OCCT build. The CI runners can't
build it: build it on the Arch workstation (`pnpm occt build`, then `pnpm occt
publish`) before CI runs on the branch.

## Results: rib

Slice 1 is in (`packages/core/src/rib.ts`,
`packages/kernel/src/features/rib.ts`, `apps/web/src/features/rib.ts`,
`e2e/rib.spec.ts`).

- **The slab is built as designed** and every step works with calls that
  already exist: `planarFaces` for the rectangle, `namedPrism` for the slab,
  `namedBoolean` for cutting the bodies out, `operate`/`splitSolids` for the
  join. No facade change, so no OCCT build.
- **`d` is signed by the bodies' centre of mass, not the middle of their box**
  as §1 first wrote it. An L's legs are on the corner side of its diagonal,
  while the box's middle lies in the bracket's opening, so the box's middle
  refuses *every* rib. The mass is where the material is (and `Kernel.properties`
  has it; the dialog reads it off the meshes with `volumeCentroid`). Both sides
  or neither (a line across the material, one in open air) leave the sign to
  `n × u` as it stands.
- **The piece is found at the line's midpoint moved `1e-4 · L` into the
  material side**, at the middle of the thickness band, with the exact
  distance (a 1 µm probe box; `BRepExtrema_DistShapeShape` says 0 inside or on).
  The "line lies inside the body" check asks the same question of the
  **midpoint**, without the direction, so it is the same error whichever way
  `d` points.
- **The "doesn't close" test is in the slab's own coordinates** (s along the
  line, t towards the body) rather than a plain box-against-box: a `both`
  wall's box touches the slab's box at the thickness band's own ends, which
  says nothing about whether the wall closed. The ends of the extension are
  named after the line (`<line>:end0`, `<line>:end1`) as §1 has it; a valid
  rib's piece never reaches them, since the legs bound it.
- **The rib's own three faces** are `rib:<id>:side:<sketch line>` (where it
  stands on the line), `…:cap:start` and `…:cap:end` (its two sides across the
  plane); the legs' faces and the fillets' carry on with the names the bodies
  gave them. The cut's `#n` suffixes are dropped, so which piece of a split
  face the rib is says nothing about the rib.
- **Kernel tests** (`packages/kernel/src/features/rib.test.ts`, real OCCT,
  `strictLeaks`): an L of a 60 × 5 mm base and a 5 × 45 mm wall, 40 mm deep,
  with a diagonal on its middle plane. The volume grows by exactly the
  triangle the extension cuts from the legs (437.5 mm²) times the thickness —
  21 875 mm³ at 2 mm, 23 187.5 mm³ at 5 mm, against 21 000 mm³ for the L — with
  11 faces and one solid; `side` one and other put the wall on one side of the
  plane with the same volume; flip, a line inside the base and a line above
  the wall all give the two errors; a rectangular pattern of the feature along
  Y gives three ribs in one body; an unrelated edit keeps the names.
  `golden/rib-options.json` is the side × flip × thickness table.
- **E2E** (`e2e/rib.spec.ts`): the Wall bracket, a line along its outer
  diagonal on the middle plane, a 3 mm rib. The 3MF volume grows by 2 915.1 mm³
  against the exact 2 916.0 mm³ of the triangle (the 0.31 mm² the 1.2 mm fillet
  takes off the corner is left out); flipped, the dialog says the rib doesn't
  close and OK is off. The template's own sketch lies in the same plane and its
  profile face takes the pick in front of the line, so the spec hides it (an
  eye) for the pick.
- **The dialog's Flip arrow** is a new manipulator kind (`kind: 'arrow'` in
  `spec.ts`, drawn by `DialogOverlay`): a direction arrow whose head a click
  turns. There was no kind for "a toggle with an arrow", and §1 asks for one.

## Results: variable fillet

Slice 2 is in (`packages/kernel/occt/facade/extrudo_facade.cpp`'s
`filletVariable`, `packages/core/src/fillet.ts`,
`packages/kernel/src/features/fillet.ts`, `apps/web/src/features/fillet.ts`,
`spikes/p4-10-harness/`, `packages/kernel/src/features/fillet-variable.test.ts`,
`e2e/fillet.spec.ts`). Status **Implemented**.

- **`fillet` and `filletVariable` share the whole build** through the private
  `filletBuild(shape, perEdge)`, `addFillets(…, perEdge, …)`,
  `filletWorks(…, perEdge)` and `explainFillet(…, perEdge, …)`: the staged
  edges, the per-chain radius setting, the `filletRollsOff` guard (with the
  **larger** of a pair, the widest the round ever gets), the build, the
  `BRepCheck_Analyzer` check and the history are one code path, so a constant
  fillet is computed exactly as before (`fillet` itself is unchanged in
  behaviour, and the evaluator only calls `filletVariable` when some set has
  an end radius).
- **A taper is one pair per chain, as §2 asks**: the first staged edge of a
  chain decides it, and two pairs on one chain are status 3 as before.
  OCCT's `Add(R1, R2, edge)` runs the whole chain: `BRepFilletAPI_MakeFillet::
  SetRadius(R1, R2, IC, IinC)` puts the two radii on the spine's radius law
  (`ChFiDS_FilSpine::parandrad`), which the builder interpolates along the
  chain — a single straight edge tapers from end to end, and the harness reads
  2 mm at one end of a box's top edge and 5 mm at the other off the fillet
  face's own vertices.
- **The law is not linear in length.** `ChFiDS_FilSpine`'s `mklaw`
  interpolates the two radii with a **zero slope at each end**, so a taper
  takes about 1 % more off than `(1 − π/4) L (r1² + r1 r2 + r2²) / 3`: a box's
  top edge 2 → 5 mm measures 7 943.41 mm³ against 7 944.20 mm³ of a radius
  linear in length (and 7 982.83 / 7 892.70 for the constant 2 mm and 5 mm
  fillets of that edge). The tests measure the ends, not the analytic value.
- **Swapping the ends is real**: which end OCCT calls the start of a chain is
  its own, so `swap` exchanges the two radii. A single edge's fillet keeps its
  volume either way (7 943.41 mm³ both); a chain of three tangent edges does
  not quite, because its two ends are different corners (one between two
  planes, one between a plane and an already rounded face). The **fillet
  face's bounding box is the same either way** (a round of radius r at a
  corner reaches 20 − max(r) back on both axes, so only the smaller end shows),
  so the tests read the body's own B-rep vertices at each end of the edge.
- **No status 1 for a taper**, as §2 says: with the radius running along the
  chain, which chain is too large depends on the direction it runs in, so the
  diagnosis is status 4's factor, scaled over both radii of every pair
  (`largestThatWorks`). The evaluator words it in fillet's own words ("These
  fillets can't all be built where they meet. Try radii up to about 19 mm, or
  fewer edges at once." — 60 mm on a 40 × 30 × 20 block's edge), with the
  largest of the pair's two radii in the arithmetic.
- **Native harness** (`spikes/p4-10-harness/`, `run.sh`, `syntax.sh`,
  `occt-src.sh`, copied from P4-04's): all its cases pass. One top edge of a
  20 mm box 2 → 5 mm (7 faces, a valid solid, the volume between the two
  constant fillets', the face's four corners at 2 mm and 5 mm, 5 → 2 mirrored);
  two equal radii give `fillet`'s own volume exactly; a chain of three tangent
  edges (the top outline of a box with one upright rounded, 18 mm + a quarter
  circle + 18 mm) 1 → 3 mm is a valid solid with the volume between the
  constant 1 mm and 3 mm ones and 3 mm at the chain's last corner, 2 → 30 mm
  fails with status 4 and a factor of 0.6641 that builds when applied; two
  pairs on one chain is status 3; a lone face's edge is status 2; the argument
  checks (one radius for two edges, three radii, radius 0, an unknown shape, an
  edge index out of range) all refuse. Leaks: 300 and 1 500 rounds flat at
  17.9 MB with the control growing 8.3 MB.
- **Kernel tests** (`packages/kernel/src/features/fillet-variable.test.ts`,
  real OCCT, `strictLeaks`): the harness's cases through the evaluator on a
  40 × 30 × 20 block — the volume strictly between the constant 2 mm and 5 mm
  fillets', the fillet face named `fillet:F:from:(<edge>)`, the block's own
  vertices putting 2 mm at one end and 5 mm at the other; two equal radii are
  the constant fillet's volume; `swap` keeps the volume and moves the big end to
  the other vertex; a chain of three tangent edges 1 → 3 mm rounds all three
  (three fillet faces, as the constant one does); a constant set and a variable
  one in one feature; a 2 → 60 mm taper gives the factor, and applying it
  builds; an end radius of 0 is refused; the same edge in a constant and a
  variable set is refused; and a spy on `Kernel.fillet` /
  `Kernel.filletVariable` shows which of the two a document takes. The
  constant fillet's own golden table (`golden/fillet-options.json`) is
  unchanged.
- **Dialog**: per set a **Variable** toggle, then **End radius** and **Swap
  ends** while it is on (set n's labels carry the number: "End radius 2"). The
  toggle is no input of its own — a set is variable exactly when it has an end
  radius (`fromInputs`), and turning it off drops `radiusEnd` and `swap`
  again, since the default mapping only writes the fields that are shown
  (`toInputs`). Opening a stored variable fillet shows Variable on with its
  two radii.
- **E2E** (`e2e/fillet.spec.ts`): the Box cube's top front edge, Radius 2 mm,
  then the same fillet at 5 mm and at 2 → 5 mm; three 3MF exports say the
  taper is between them, the body is `Body1:7:20,20,20`, and swapping the ends
  keeps the volume. Unchecking Variable hides the end radius again.

## Slices

1. Rib: core, kernel (tests on the Wall bracket's L: a diagonal line on the
   midplane gives one body whose volume grows by the triangle's area × thickness;
   `side` one/other; flip into empty space refused; a line inside the body
   refused; a line whose end doesn't reach a leg refused), dialog, e2e
   (`e2e/rib.spec.ts`), docs.
2. Variable fillet: facade (native harness first: a box edge 2 → 5 mm, a chain of
   three tangent edges, too large → factor), OCCT build and publish, core, kernel
   tests (volume between the two constant fillets' volumes; swap mirrors it),
   dialog, e2e, docs.

## Rejected

- **Rib by projecting the line onto the body and lofting:** needs the body's
  section curves, fragile; the slab cut is exact and uses tested booleans.
- **Rib "normal to the sketch" (material grows along the plane normal):** a
  different feature in practice (an extrude to the body does it).
- **Variable radius by laws at intermediate points** (`SetRadius` with a
  `Law_Function`, or radii at chosen vertices): more UI than the common case
  (a taper from one end to the other) needs; the input names leave room.
- **Changing `fillet` to stage two radii always:** it would change every
  existing fillet's build path for no gain.

## Deferred

- Ribs from chains of lines and arcs, draft on ribs, several ribs per feature
  (a pattern does it); variable fillets with radii at intermediate points.
