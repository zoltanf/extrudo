# ADR-0048: 3D-print aids

- **Status:** Accepted, 2026-09-30
- **Task:** P3-10 (FR-3DP-02 mass properties with filament presets,
  FR-3DP-03 overhang analysis, FR-3DP-04 place on bed). Code: the app's
  `apps/web/src/print/` (`material.ts`, `overhang.ts` the maths,
  `usePrintAids.ts` the logic, `PrintInfoPanel.tsx`, `OverhangPanel.tsx`),
  the view's `viewport/overhangShading.ts` and its use in
  `viewport/Bodies.tsx` / `Viewport.tsx`, `OverhangState` in the viewport store
  (`viewport/store.ts`), the Analysis folder row in `shell/BrowserPanel.tsx`,
  the tools in `shell/tools.ts` (3D Print › Prepare), "Place on Bed" in
  `shell/contextEntries.tsx`; for Place on Bed the feature
  `packages/core/src/place-on-bed.ts`, the evaluator
  `packages/kernel/src/features/place-on-bed.ts` with `faceDown` in
  `features/matrix.ts`, the dialog `apps/web/src/features/place-on-bed.ts`.
  **No facade change, no migration; one new feature type, documented in
  `docs/file-format.md` (6.15).**
- **Builds on:** ADR-0035 (`KernelApi.inspect` gives exact volumes), ADR-0034
  (export writes the bodies as they are), ADR-0044 (`transform`,
  `transformBodies`, names carried through the move), ADR-0045 (an analysis is
  view state with a panel and an Analysis folder row), ADR-0026 (the display
  meshes), ADR-0027 (feature dialogs), ADR-0042 (context entries).

## Context

Three things that print-minded users do before they slice: find out how much
plastic a part takes, see where it needs support, and turn it so that a
good face lies on the plate. The first two are ways of looking at a model, the
third changes the orientation the model is exported in, so it has to be part
of the design.

## Decision

### 1. Print Info: exact volume, a material preference

The panel (`PrintInfoPanel`, 3D Print › Prepare › Print Info) asks the kernel
for the exact volume of each body (`KernelApi.inspect` with body targets, the
same call as Measure) and shows volume, weight and filament length. The
bodies are the ones selected (a face or an edge counts for its body), or every
shown one; the same rule as the export dialog's (`initialBodies`).

- **Weight** is volume × density. Presets in g/cm³: PLA 1.24, PETG 1.27,
  ABS 1.04, TPU 1.21, or a custom density (`<ExpressionInput>`, a plain
  number above 0).
- **Filament length** is the volume over the cross-section of the filament
  (1.75 mm by default, 2.85 mm): a printer feeds a cylinder of the same
  volume, so the length doesn't depend on the material. The panel says so
  under the numbers.
- **Infill is not modelled.** The panel says "Solid, 100 % infill: a real
  print with infill is lighter". The numbers are an upper bound, which is the
  honest reading of a solid model. **Superseded in P4-12** (amendment below):
  the panel now estimates a print with walls and infill, and 100 % infill is
  the case above.
- **The material is a preference** (`print.material`: preset, custom density
  expression, filament diameter), not a document setting. It is what a person
  prints with, which follows them from design to design, and it costs no
  schema change, migration or file-format text. A document setting would
  make sense if a design should say what it is meant to be printed in (so
  that a shared file shows the same weight); that can be added later as an
  optional `settings` key without breaking this.

### 2. Overhang analysis: view state, CPU counts, GPU shading

The rule, for a unit "down" vector `d` and an angle N: a triangle is an
**overhang** when its normal points more than N° below the horizontal,
`normal · d > sin N` (strictly: a face exactly at N° passes). N is 0…90°: a
flat ceiling (normal = d) is the worst case, a wall is never one, at 0°
every downward face is flagged and at 90° none. The default is 45° and -Z, the
bed; the panel offers ±X, ±Y, ±Z. **Faces on the bed are not overhangs:**
a triangle whose corners all lie at the lowest level of the shown bodies along
`d` (within 0.01 mm) has nothing under it. The bed is "the lowest point of
what is shown", not "z = 0": it is where the model would rest, and it makes the
analysis independent of where the design sits in space. A design that floats
above the origin still shows its underside as bed contact (the model is
assumed to be laid down).

Like the section, **the analysis is view state**: `viewport.overhang`
(`OverhangState`: the angle as an expression, the down axis, `on`), not in the
document, not undoable, not a preference. The angle is an expression evaluated
with the document's parameters (0…90° checked; an angle that stops evaluating
keeps its last value). It is switched on and edited from the panel, and its
row in the browser's Analysis folder (now shared with the section: each row
has its eye and menu, the folder's eye turns both) toggles, edits or removes
it. It is not drawn in sketch mode.

Two implementations of one rule, on purpose:

- **Counts on the CPU** (`print/overhang.ts`): per triangle, over the display
  mesh, the normal being the mean of the three node normals (the kernel's
  exact surface normals, so a cylinder's triangles differ as the surface
  does). It gives per-face flags, triangle counts, overhang area and the
  number of bed triangles, and feeds the panel line and the Viewport region's
  `data-overhang` ("down=-z angle=45 faces=1 triangles=11 area=226 bed=90").
  No kernel call.
- **Shading on the GPU** (`viewport/overhangShading.ts`): a patch of the
  standard face material (`onBeforeCompile`) that tests the interpolated normal
  and the fragment's height against the same threshold and bed level, and
  mixes the colour `--x-error` (both themes define it; red reads on dark and
  light bodies) over the body colour at 82 %. Because it works per fragment, a
  cylinder is cut along a crisp line at the angle instead of a triangle at a
  time, and changing the angle or the direction only changes uniforms: no
  colour buffer to rewrite, no geometry to rebuild, dragging is free. Section
  clipping is a material property that runs first, so clipped fragments are
  never shaded and the analysis keeps working with a section on. A hover or
  selection tint still shows faintly under the red.

The two can differ by a fraction of a triangle at the threshold on curved
faces (the count uses one normal per triangle, the shader one per fragment);
flat faces, which are what a test can name, agree exactly.

### 3. Place on Bed: its own feature, worked out from the face

**Place on Bed is a feature of its own, `placeOnBed`, with one input, the
flat face.** The kernel finds the body the face is in (`ctx.resolve`), reads
the face's plane (outward normal and centre) and builds the matrix in
`faceDown` (pure, unit tested): the smallest rotation that turns the normal
to -Z, about the axis `normal × -Z` through the face's centre, then a move
straight down by the height of the face's centre. A face already facing down
is not turned, a face facing up turns half a turn about X. The face's centre
keeps its X and Y, so the body doesn't jump sideways. It is applied with the
same `transformBodies` as Move (one facade `transform`, history for every
sub-shape), so every face keeps its persistent name and features after it
still resolve. The body keeps its ID.

Why not a stored matrix, and why not a mode of Move:

- **Robust to change.** The task said to choose between a `move` with a
  computed rotation and translation and a new Move mode ("face to plane"). A
  stored rotation and translation are numbers computed when the user clicked;
  edit the body before it (a wall thickness, a fillet) and the numbers are
  wrong. Recomputing from the face reference follows the body: the face is
  found by name (ADR-0005), and its plane read on every recompute. That is the
  reason to build a face-driven feature, whichever registry it sits in.
- **A Move mode would put the face in the wrong dialog.** Move is about
  bodies and a gizmo; Place on Bed needs only a face (the body follows from
  it), so its dialog has one field, and a body the face belongs to that isn't
  picked can't be forgotten. As a Move mode it would also have needed the
  dialog controller to open a dialog with a mode preset (a tool per mode has
  no precedent), or a second spec for the same feature type, which the
  registry (keyed by type) doesn't allow. As its own type, the tool ID is the
  feature type is the command, like the primitives (ADR-0032): the toolbar
  tile "Place on Bed" (which had a placeholder waiting since P0-04), the
  context entry, the timeline chip ("Place on Bed1") and Fix References all
  work with no special cases.
- **It touches no shared evaluator.** `transformBodies`, `withImages` and
  `isIdentity` in `transform.ts` gained an `export`, nothing else changed
  there.

Behaviour worth knowing:

- The face has to be flat (an error says so otherwise: "That face isn't flat,
  so it can't lie on the bed") and to exist (a lost face is a
  `LostReferenceError` through `ctx.resolve`, so Fix References offers it).
- **"Bottom at z = 0" means the face at z = 0**, not the lowest point of the
  body. If the body reaches below the face (an L bracket laid on its inside
  wall), the feature succeeds and warns: "Part of the body reaches 37.6 mm
  below the bed: the face isn't its lowest point." Refusing would hide a
  choice the user may mean; silence would print in the air.
- A face that is already on the bed is a warning, "nothing moves", like a Move
  by zero (a parameter can make it so legitimately).
- The rotation about Z is not chosen: the smallest turn keeps the part's
  orientation about the vertical as far as it can. A Spin angle field would be
  a natural addition (open items).

**The export needs nothing.** The body in the model is the body in the file:
`exportMeshes` and `writeStep` take the engine's bodies as they are, which
include the placement. A kernel test exports a placed body and checks the mesh
sits on z = 0; the e2e spec exports a 3MF of the placed wall bracket.

The tool is 3D Print › Prepare › Place on Bed (a dialog: pick a face, live
preview, OK is one undo step) and "Place on Bed" in the context list of a
single flat face, which starts the dialog with the face already picked.

## Consequences

- Placement is undoable, editable (reopen the chip, pick another face) and
  survives parameter edits. It reorders nothing in the timeline (a feature
  depends on the features named in its face reference, ADR-0033).
- Print Info and the overhang analysis add no document data; a file made with
  Place on Bed opens in an older build as a feature of an unknown type
  (`docs/file-format.md`, section 3).
- The overhang counts and the shader use two code paths for one rule; the
  unit tests pin the maths and the e2e spec reads the counts, but nothing
  checks the shader's pixels automatically (no screenshot is checked in; the
  shading was looked at in both themes on the wall bracket in headless
  Chromium).
- All bodies share one bed. A model with two parts at different heights shows
  the higher part's underside as overhang, which is right for a print plate
  with both on it only if the higher part rests on something; Place on Bed
  each part first.

## Rejected

- **A stored rotation and translation in a `move`** (or a Move mode with a
  matrix): breaks when an earlier feature changes the body, as above.
- **Rewriting the face's body with a boolean or a facade "orient" call.**
  The facade already has `transform`; no facade change was needed or allowed.
- **Filament length from mass and a linear density** (g/m): the density is in
  the preset anyway, and the geometric reading needs no second table.
- **The material as a document setting.** See above: a preference costs no
  format change; it can be added later.
- **Colouring the display mesh's colour attribute for the overhang** (per
  vertex, as the face tints are painted). Faces would have to be
  re-coloured on every angle change, the boundary would blend across a
  triangle, and the selection tint shares that attribute.
- **Per-face classification only** (a face overhangs if its centroid normal
  does): wrong for a cylinder, whose lower half is the overhang, not the whole
  face.
- **Asking the kernel for overhang faces** (a facade call or the exact
  surface normals per face). The display mesh has the exact normals; a kernel
  round trip per drag step buys nothing.
- **"The bed is z = 0".** It made the analysis depend on where the design
  happens to sit; the lowest point of what is shown is where it would rest.

## Open items

- ~~A Spin angle (about Z) in Place on Bed, and Place on Bed for several bodies
  (each on its own face).~~ Done in P3-17 (amendment below).
- ~~The down direction from a picked face~~ (done in P3-17, below); an
  arbitrary vector is still open (today an axis or a face).
- ~~Per-body support estimates (volume of support), infill in the weight, a
  cost per kg~~ — infill and cost done in P4-12 (amendment below); support volume
  is still open: generating supports needs a slicer.
- Overhangs in the dialogs' preview shapes (only the bodies are shaded).
- ~~A checked-in screenshot of the shading, in CI's image.~~ Done in P3-17
  (amendment below).

## Amendment (P3-17)

**Place on Bed: Spin and several bodies.** `placeOnBed`'s `face` input takes
any number of faces (it took one) and gains an optional `spin` angle
expression. No schema version change and no migration: both are additive
(a file with one face and no spin reads and recomputes as before; a newer
file read by an older Extrudo drops `spin` with the lenient-reading notice of
ADR-0050, but one with several faces fails the old `max 1` check, which is
the same as any newer feature input). `docs/file-format.md` §6.15 says it.
The kernel resolves every face, refuses two faces of one body ("a body lies on
one face"), and gives each body its own `faceDown` matrix, followed by a
rotation about the vertical through the **face's centre at z = 0** by the
spin (positive counter-clockwise from above), so the face's centre stays
where it was in X and Y whatever the spin. Each body drops to z = 0 where it
is: the bodies are not arranged on the plate (that is a packing problem, not
this feature). "Already on the bed" is said only when every face is and there
is no spin; the below-the-bed warning covers all bodies. The dialog's
Face field takes several picks (one per body) and has a Spin field.

**Overhang: down from a picked face.** `OverhangState.face` is an optional
persistent `GeomRef` (view state like the rest, no schema). While it is set,
"down" is the face's **outward normal** (the way Place on Bed turns it) and
the bed is the face's **plane** (faces lying in it are bed contact): the
model as it would print standing on that face, whether or not that face is
its lowest level. It is resolved from the current meshes on every render
(`faceDown` in `print/overhang.ts` over `sectionFrame`, with the
fingerprint as the fallback), so it follows the model; a face the model no
longer has leaves the shading off (`data-overhang` reads `down=face(?)`).
The panel's "Use selected face" button takes the single flat face selected in
the model (`kernel.reference`, curved faces say so), the Down list then shows
"Picked face", and choosing an axis replaces it. `data-overhang` reads
`down=face(-1,0,0)` (the unit direction, rounded), the browser row
"Overhangs · Face · 45°". Not done: a context entry ("Overhangs from Here")
and an arbitrary vector.

**The shading screenshot.** `e2e/print-aids.spec.ts` takes the Viewport region
(`overhang-shading-chromium-linux.png`, dark theme) of the wall bracket with +Z
as down in the home view: the upward faces of the base plate are red, the wall
is not. +Z rather than the default -Z because the bracket's overhangs under
the default (the rounded corner) can't be seen from above. Like the section's
shots it is made in the Playwright Ubuntu image (`--update-snapshots=all`), not
on this machine.

## Amendment (P4-12): Print Info with walls, infill and cost

**The estimate is for a print, not only for the solid part.** The
`print.material` preference gains four fields, all with defaults so that a
preference written before them reads as it did: `walls` (a whole count, 2),
`lineWidth` (mm, "0.45"), `infill` (%, "15") and `price` (per kg, "25"). The
panel has a field for each — Walls, Line width, Infill and Price per kg, every
one an `<ExpressionInput>` like every other number — and two more rows under the
volume: **Printed (est.)** and **Cost**. The material and the filament diameter
are unchanged.

**The maths** (`printEstimate` in `material.ts`, pure and unit tested): for each
body, whose volume *and area* the kernel already measures (ADR-0035's
`properties`), the skin is `min(volume, area × walls × lineWidth)` and the
interior is what is left. `printed = skin + interior × infill`, and the weight,
the filament length and the cost (`weight / 1000 × price`) follow from the
printed volume. At 100 % infill this is the solid part exactly, so P3-10's
numbers are a special case of it, not a different rule.

- **The skin is worked out per body, not over the sum.** A model of two thin
  plates has two small interiors, where one thick block of the same total volume
  has one: `min` per body first, then the sum.
- **A part thinner than its walls is all skin.** A real slicer spends more than
  one line width of material on such a part (and a slicer knows its layer
  heights, its top and bottom layers, its seam, its perimeters' spacing and its
  sparse or gyroid patterns). The panel never claims more material than the part
  has, and its note says what the number is: "An estimate: walls and infill as
  set, no supports."
- **The price has no currency.** The panel shows a plain number with "/ kg" and a
  cost with no symbol: the filament's price is whatever the user buys, and
  guessing a currency (or converting one) would be wrong for most of the world.
- **Every field is a plain number of its own unit, evaluated `unitless`.** A line
  width is millimetres whatever the document's units, because this is the
  printer's setting, not the drawing's: a bare number in a length field would
  take the document's unit (ADR-0004), so "0.45" would mean 11.4 mm in an inch
  design. `checkPrintField` then refuses a density or a line width that is not
  above 0, a wall count or a price below 0 and an infill outside 0…100 %, with a
  message that names the range; the wall count is rounded, and a value that
  doesn't evaluate is never committed, so the last number stands.
- **Support volume is still open.** Where support material comes from (which
  faces need it, at what density, tree or raft) is a slicer's decision; a model
  cannot be asked for it. It would need the slicer's own support generation, not
  a formula here.

Nothing else moved: no schema, no migration, no file-format text (it is a
preference, as decided above), no kernel change (the area was already there) and
no undo — these are settings of the person printing, like the material, so the
e2e spec checks that a reload keeps them and that Ctrl+Z does not touch them.

**Rejected**

- **Slicing the model in Extrudo** (meshing the interior, computing perimeters,
  layers, seams). That is a slicer: P4-08 leaves the hand-off to one
  (`Platform.openInSlicer`), and a second, cruder implementation of it here
  would disagree with every real slicer about what a print needs.
- **A per-layer or per-body breakdown** (what each wall and each body's infill
  costs). More numbers than a person deciding a print needs, and the skin is an
  estimate anyway.
- **A layer height, top/bottom layer count or seam length** in the preference.
  Each is one more field for a number this panel cannot act on, since the skin
  formula does not use them; if the formula ever grows them, they come with it.
- **The price in the document** (so a shared file shows the same cost). Decided
  against in §1, and it has not changed: what a print costs is what the person
  pays.
