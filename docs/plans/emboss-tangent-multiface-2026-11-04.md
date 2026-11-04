# Emboss: "tangent to the face" and several faces at once (plan, 2026-11-04)

The last two Emboss items of the P4-12 backlog (`docs/03-roadmap.md`, "Emboss:"),
both from ADR-0060's Deferred list and its amendment's A5. **Being built** on the branch
`claude/emboss-tangent-multiface` (2026-11-04), as ADR-0060's second amendment. The owner's decisions are in §14 (all five taken 2026-11-04); the slices in
§10 follow them.

## 1. Goal

1. **"Tangent to the face"** for a flat sketch far from the face: put the letters on
   the face as if they had been sketched on the face's tangent plane right in front
   of them, whatever the angle and distance of the sketch.
2. **Several faces at once**: one emboss across neighbouring faces of a body (a
   stepped top, a flat front and its fillet, a lofted surface made of several
   faces), each face taking the part of the letters that lands on it.

## 2. What the code does today (facts the plan builds on)

- The method follows from the face (`packages/kernel/src/features/emboss.ts`): a
  flat face takes the profiles **moved** along its normal (`flatTool`), a cylinder
  or cone takes them **wrapped** (`wrappedTool`, facade `wrapOnCylinder` /
  `wrapOnCone`), anything else **projected** along the sketch's normal
  (`projectedTool`, facade `projectOnFace`). `EmbossReport.method` says which.
- **Distance never matters**: a parallel sketch is moved by any offset; a wrap
  measures `s` in the sketch plane from `corner` (the foot of the axis on the
  plane), so a far axis-parallel sketch already rolls onto the cylinder; a
  projection runs along a line. So "far" alone is no gap.
- **What is refused**: a flat face with a sketch that isn't parallel to it; a
  cylinder or cone whose sketch plane doesn't run along the axis. That includes a
  sketch on the **cone's own Tangent Plane** (ADR-0040 makes one through the apex,
  normal tilted by the half-angle against the axis), so Construct › Tangent Plane →
  Sketch → Emboss works on a cylinder and fails on a cone.
- **What reads oddly**: a sketch whose normal points into the body (XY over a box's
  bottom face, or the far side of a cylinder) gives letters that read mirrored from
  outside. A projection of an off-centre text onto a sphere runs along the sketch's
  normal, so the letters are foreshortened towards the outline.
- **The face only gives its surface** for a move or a wrap: the tool is joined to the
  whole body, so letters past the face's edge hang off it unclipped, and a text
  across the two halves of a split cylinder already works with one face picked. A
  projection is bounded by the face (refused past its edge).
- `face` is `refsOf(EMBOSS_FACE_KINDS, 1)` (one face); the dialog's Face field has
  `max: 1`. An older reader that finds an input it doesn't know ignores it with a
  warning (engine, P3-13); an input that fails its schema marks the feature
  "Invalid inputs".

## 3. Feasibility checked (2026-11-04, real OCCT in Vitest, throwaway file, not committed)

A Kernel-level experiment in this worktree (`kernel.box`, `fillet`, `planarFaces`,
`wrapOnCylinder`, `wrapOnCone`, `prism`, `revolve`, `common`, `fuse`, `cut`; strict
release, 0 live shapes at the end; ~0.8 s):

| Case | Result |
|---|---|
| 40×40×10 box, one vertical edge filleted R 5; a 10×4 rectangle on the plane y = 50 straddling the seam between the flat +Y face and the fillet. Flat piece: moved onto y = 40, prism 1 mm, `common` with the face's own 1 mm prism. Fillet piece: `wrapOnCylinder` from the same sketch (frame on the fillet's axis), `common` with the fillet's annular quarter (same surfaces as a simple offset of the face) | flat 20.000000, fillet 22.000000 (= A·d·(R + d/2)/R), fused tool **one valid solid, 42.000000**, 10 faces (8 with the boolean's simplify); joined to the body: one valid solid, body + 42 exactly |
| The same as a deboss | pieces 20 / 18.000000, tool 38, cut: one valid solid, body − 38 exactly |
| A 10×4 rectangle on a plane tilted by the cone's half-angle (20°) — a tangent-plane sketch — turned back about the line (corner, `across`) and wrapped with `wrapOnCone` | 40.939692662991646, **identical** to the rectangle drawn on the axis-parallel plane (ADR-0060 A4: 40.9396927); the tilted one passed straight in is refused ("…isn't on a plane parallel to the cylinder's axis.") |

So: the wrap's frame rule already makes a flat face and its tangent fillet line up
exactly (the fillet's `s = 0` is its seam with the flat face), per-face pieces fuse
cleanly through the coincident-surface booleans, and a cone tangent-plane sketch
needs only a rigid turn in TypeScript. The code is in the session notes folder
(`emboss-plan-spike.test.ts`); the cases go into the kernel tests of §8.

## 4. Behaviour from the user's side

### 4.1 Cone tangent planes (no new input)

A sketch on a plane parallel to the cone's axis **or to one of its tangent planes**
(the normal at `90° ± α` to the axis) is wrapped. The second kind is turned about
the line through the profiles' centroid along `across` until it runs along the axis
(exact: a rigid turn, then today's map). So Tangent Plane → Sketch → Emboss works on
a cone as on a cylinder. Every other plane is still refused, with the message
"Sketch on a plane parallel to the cone's axis, or to one of its tangent planes, to
emboss on a round face."

### 4.2 Tangent to the face (new toggle, off by default)

With **Tangent to the face** on, the kernel first lays the profiles on the face, then
uses the face's method as today:

1. **Anchor**: the line through the profiles' area centroid along the sketch's
   normal, met with the face. The hit nearest the centroid, either way along the
   line (a tie goes to the side the sketch's normal points to). Distance doesn't
   matter. No hit: "Tangent to the face needs the face in front of the profiles:
   the line through their centre along the sketch's normal misses it."
2. **Fold**: the sketch turns about the line where its plane meets the face's
   tangent plane at the anchor (the smallest turn that takes the sketch's normal to
   the face's outward normal there) and moves so that the centroid sits on the
   anchor. When the two normals are opposite, the sketch turns over about its own
   up direction (the sketch frame's y), so up stays up.
3. **Method** as today, from the laid profiles: moved (flat), wrapped (cylinder;
   cone through 4.1's turn), projected along the face's normal at the anchor
   (anything else; the laid profile is moved out by `depth + 1 mm` along that
   normal first, so that `projectOnFace` finds the face in front of it).

What changes for the user:

| Case | Off (today) | On |
|---|---|---|
| Flat face, sketch at an angle (XY over a 45° chamfer) | refused | folded onto the chamfer, centred straight below the text |
| Flat face, sketch facing into the body (XY under the bottom face) | letters read mirrored from below | read the right way round from below |
| Cylinder or cone, sketch at an angle to the axis | refused | folded and wrapped round the anchor |
| Cylinder, axis-parallel sketch, text 5 mm off centre (R 20) | centre at `s/R` = 14.32° | centre at `asin(s/R)` = 14.48° (0.05 mm along the wall), same letters |
| Sphere, text off centre | projected along the sketch's normal: foreshortened | centred and undistorted at its point, projected along the sphere's normal there |
| A hole's wall | as seen through the material | read from inside the hole |

The rule in one sentence for the docs: *the letters land as if you had made a Tangent
Plane at the point straight in front of them and sketched them there.*

### 4.3 Several faces

- The field becomes **Faces** and takes several faces of **one body** (a click adds
  or removes, as on Fillet's edges). Faces of two bodies: "Pick faces of one body to
  emboss on."
- **Each face takes the part of the letters that lands on it**, by the method it
  would take alone, **clipped to that face**; the pieces fuse into one tool, which
  joins or cuts the body. So the letters stop where the picked faces end.
- **Mixing rule**: when any picked face takes a projection, every curved face is
  projected too (flat faces parallel to the sketch are moved, which is the same
  thing), so the letters line up at every seam. Otherwise flats are moved and
  cylinders and cones wrapped: letters line up across a flat face and the fillet
  tangent to it on the side that looks at the sketch (the spike's case: a box's
  front and its rounded corners) and across the pieces of one cylinder; where a wrap
  meets a face at a sharp edge away from `s = 0` (a D-shaped shaft's flat) a letter
  across the edge jogs. The docs say so.
- **One face behaves exactly as today** (unclipped), so existing documents don't
  change (decision 4.1).
- A face that none of the letters reach: a warning "No letters land on face *k*."
  None reached at all: "The profiles don't touch the faces."
- **Tangent + several faces**: one anchor (the nearest hit over all picked faces),
  one fold for all of them.
- The read-only **Method** line names each method once, in face order: "Moved onto
  the face", "Moved onto 2 faces, wrapped round the cylinder", "Projected onto 3
  faces".

## 5. Schema (core, additive; no `formatVersion` bump)

`packages/core/src/emboss.ts`:

- `face: refsOf(EMBOSS_FACE_KINDS)` (the `1` goes);
  `.describe('The faces to emboss on, all of one body: each takes the part of the letters that lands on it. The body is the only one touched.')`.
- New `tangent: BoolInputSchema.optional().describe('Lay the profiles on the face first, as if sketched on its tangent plane straight in front of them: any sketch angle, the letters read the right way round from outside. Default false.')`.
- `EmbossSettings`: `faces: GeomRef[]` replaces `face?: GeomRef`; `tangent: boolean`.
  `embossInputs(profiles, face: GeomRef | GeomRef[], { depth, mode, tangent })`.
- `EmbossReport`: add `faces: EmbossMethod[]` (one per picked face, in order;
  `method` stays, `= faces[0]`) and `anchor?: { origin: Vec3; normal: Vec3 }` (only
  with `tangent`, for the dialog's arrow).
- `embossMethodsText(methods: readonly EmbossMethod[]): string` beside
  `embossMethodText` (which stays for one face).
- `EMBOSS_FACE_ROLES` = `SWEEP_FACE_ROLES` plus
  `{ pattern: 'clip:<n>', description: 'A wall where the letters stop at the edge of the picked faces: n is the face's place in the Faces list.' }`;
  `embossFeature.faceRoles` uses it.
- `docs/file-format.md` §6.26: the `face` and new `tangent` rows, the clip names,
  the older-reader note (an older Extrudo ignores `tangent` with its unknown-input
  warning and marks a several-face emboss "Invalid inputs"). Then `pnpm
  api:generate` (`docs/api/`, `apps/desktop/skill/extrudo/references/api.md`).

## 6. Facade (one OCCT build, slice S2)

`packages/kernel/occt/facade/extrudo_facade.cpp`, beside `projectOnFace` (~line
4587) and `thickPiece` (~4818); wrappers in `packages/kernel/src/kernel.ts` and
`occt/types.ts`. No OCCT type in a signature; nothing that exists changes its
results (`wrap.test.ts`, `emboss*.test.ts`, the P4-04 and P4-12 harnesses pass as
they are).

| Method | What | Returns |
|---|---|---|
| `int faceHit(int shape, int face, double px, py, pz, double dx, dy, dz)` | The hit of the line through `p` along `d` with the bounded face nearest `p`, either way (`IntCurvesFace_Intersector`, as in `projectOnFace`); the face's outward normal there (`projectOnFace`'s `outwardAt` lambda moved to a private helper, second derivatives at a pole) | 6 numbers in `geometryNumbers` `[x, y, z, nx, ny, nz]`, or -1 with `lastError()` |
| `int faceSlab(int shape, int face, double depth, bool outward)` | The solid between the face and its offset by `depth` along its outward normal or against it: `thickPiece`'s simple-offset branch (a copy of the face, `BRepOffset_MakeSimpleOffset`, `OrientClosedSolid`) | handle; history input 0 (the face): `first` (its copy), `last` (the offset), `generated` per face edge (the walls) |
| `projectOnFace(…, bool clip)` (new last argument) | With `clip`, the two "reach past the face's edge" refusals go (each sample's first hit on the face; the kept solid bounded only by face, offset and walls); the facing and back-side rules stay; for a sphere or torus the concentric shells only when the face is closed, else the simple offset (a dome's piece must stop at its rim) | as today; surviving thick-piece walls get no history (named in TS, §7) |

TS: `Kernel.faceHit(shape, face, point, direction): { point: Vec3; normal: Vec3 } |
undefined`, `Kernel.faceSlab(shape, face, depth, outward = true): OperationResult`,
`projectOnFace(profile, body, face, depth, outward = true, clip = false)`.

**Native harness first** (extend `spikes/p4-12-emboss-faces/`, `run.sh`, `run.sh
leaks 300`): `faceHit` on a plane, cylinder (both hits), sphere pole, B-spline loft
side, a miss; `faceSlab` volumes of a plane face (area × d), a cylinder face
(`A d (R ± d/2)/R`) and a cone face against the formulas to 1e-9; `projectOnFace`
clip on a rectangle overhanging a flat face (clipped volume exact), a dome with a
pole (revolved quarter arc: the piece stops at the rim), two adjacent loft faces
(the two pieces fuse into one valid solid), the Sphere primitive (clip changes
nothing: today's 28.4274498 exactly); leaks flat over 300 rounds. Record the WASM
size change.

## 7. Kernel evaluator

`packages/kernel/src/features/emboss.ts` (and small touches):

- `sources.ts`: `Base` gains `up?: Vec3` (the sketch frame's `y`, from
  `data.frame` in `profilePart` and `textParts`); nothing else reads it.
- **S1, cone tangent planes**: in `wrappedTool` before `wrapFrameOf`, when the cone's
  `|n · a|` is within 1e-6 of `|sin α|`, `rollOntoAxis(ctx, scope, parts, axis)`:
  `turnTo(centroid, n, unit(n − (n·a) a))` (`features/matrix.ts`), applied to every
  part with `transform`, edge sources through the history (`edgeSourcesOf`, as
  `moveOnto`), `plane` updated. The refusal message changes (§4.1).
- **S3, tangent**: `layTangent(ctx, scope, parts, hits): { parts: Base[]; anchor }`
  before the method choice: centroid `c` (`partsCentroid`), normal `n`, the nearest
  `kernel.faceHit(hit.shape, hit.index, c, n)` over the picked faces; the matrix
  `compose(translation(anchor − c), fold)` with `fold = turnTo(c, n, normal)`, or
  `rotation(c, up, π)` when `n · normal < −1 + 1e-9`; every part transformed as in
  S1. A projected face then moves the laid parts out by `depth + 1` along `normal`.
  The report's `anchor` is `{ origin: anchor, normal }`.
- **S4, several faces**: resolve every face (`ctx.resolve`, label "face *k* to emboss
  on"); one body or the error; each face's method as alone (`threadFace` /
  `coneFace` / `flatFaceOf`), then the mixing rule (any projected → curved faces
  projected); a tool per face: `flatTool` / `wrappedTool` / `projectedTool`
  unchanged for one face; with several faces each is clipped —
  `namedBoolean('common', tool, slab)` with `slab = kernel.faceSlab(...)` for moved
  and wrapped pieces, `clip: true` for projected ones; an empty piece (no solid)
  is released and warned about; the pieces go through `mergeTools`; faces named
  `emboss:<id>:new…` after it (the clip walls) are renamed `emboss:<id>:clip:<k>`
  (`k` from 1, the face's place in the list); then the distance check, `operate`,
  `splitSolids` as today. `data.origin`/`direction` from the first face's piece.
- Every tool is tracked by `scope` exactly once (`mergeTools` hands a lone part back
  already tracked: don't track it again).

## 8. Dialog and docs (S5)

`apps/web/src/features/emboss.ts`:

- Face field: label **Faces**, no `max`, prompt "Pick faces", hint: "The faces the
  letters go on, all of one body: each takes the part of the letters in front of it,
  and the letters stop where the faces end."
- New toggle `tangent`, label "Tangent to the face", default off, hint: "Lay the
  letters on the face as if sketched on a tangent plane right in front of them: any
  sketch angle, the right way round seen from outside."
- Method line: `embossMethodsText(ctx.draftEmboss.faces)`.
- `embossManipulators`: the report's `anchor` when there is one (origin, normal ±),
  else today's frame from the first face.
- `docs/guide/tools/emboss.md` notes block (several faces, the toggle, the jog
  caveat); `pnpm docs:generate` if the tool list changed; `docs/agent/e2e-notes.md`
  (button "Faces", "2 faces", the toggle's label); `docs/agent/adr-digest.md`'s
  ADR-0060 paragraph; changelog line; roadmap tick.

## 9. Tests

Kernel (real OCCT, strict leaks; `features/emboss-faces.test.ts` unless noted):

- **S1**: a rectangle on a Tangent Plane of the 20° cone (the construction feature)
  wraps to the volume of the same rectangle on an axis-parallel plane (1e-9), its
  centre on the touching generatrix; a plane at neither 90° nor `90° ± α` to the axis
  refused with the new message; the countersink and "across the axis" refusals in
  `emboss.test.ts` keep passing (message text updated).
- **S2**: wrapper tests for `faceHit`, `faceSlab`, `projectOnFace(…, true)` (new
  `packages/kernel/src/emboss-facade.test.ts`): the harness's numbers.
- **S3**: XY rectangle over a box's 45° chamfer, tangent on: volume = area × depth
  (1e-9), the cap in the chamfer's plane; an L-shaped profile on XY under the bottom
  face: reads right way round from below (`solidAt` probes on the L's foot); a sketch
  tilted 30° to a cylinder's axis wraps `A d (R + d/2)/R` (1e-5); the off-centre
  circle on a sphere gives the centred circle's exact column volume; the missing-line
  error; `tangent` absent = the golden table byte-identical.
- **S4**: two parallel flat faces of a stepped top (sum of the pieces, exact); the
  spike's flat + fillet, out and in (42 / 38, 1e-6); a text over both halves of a
  split cylinder equals the one-face wrap (1e-6); a capsule (cylinder + spherical
  end) projects both; three faces of a loft (valid, one solid per letter); faces of
  two bodies refused; a face no letter reaches warns; names: `side:<curve>#n`
  across pieces, `clip:<k>`, unique; one face: golden table and names unchanged
  (decision 4.1).
- **S5** (`apps/web/src/features/emboss.test.ts`): the toggle maps to `tangent` and
  back; a second face click adds; pre-selection of two faces fills Faces; the method
  line for one and several faces; the arrow at the report's anchor.
- **E2E** (`e2e/emboss.spec.ts`, S6): (a) the existing drafted Cylinder (a cone), a
  Tangent Plane on it and an Offset Plane 5 mm out from that (so the letters are
  clear of the body and clickable, e2e notes), "AB" sketched there: "Wrapped round
  the cone" with the toggle off; (b) a Box with a chamfered top edge, a rectangle on XY above it, toggle on:
  volume + area × depth; (c) a Box with one vertical edge filleted R 5, "AB" on an
  offset plane in front of it across the seam, both faces picked: "Moved onto the
  face, wrapped round the cylinder", the body's volume grows. `--repeat-each=2`.

## 10. Slices (each 1-3 h, a check after each; the coordinator reviews every one)

| # | Slice | Files | After | Worker | Acceptance |
|---|---|---|---|---|---|
| S0 | ADR-0060 second amendment (decisions, rejected) | `docs/adr/0060-emboss-deboss.md` | — | coordinator | first commit on the branch |
| S1 | Cone tangent planes accepted (TS only) | kernel `features/emboss.ts`, `emboss-faces.test.ts`, `emboss.test.ts` messages | S0 | opencode GLM | S1 tests; `pnpm check` |
| S2 | Facade `faceHit`, `faceSlab`, `projectOnFace` clip; harness; wrappers | facade, `kernel.ts`, `occt/types.ts`, `spikes/p4-12-emboss-faces/`, new `emboss-facade.test.ts` | S0 | Claude Opus | harness + leaks; CI `occt-<hash>` release; S2 tests |
| S3 | Tangent toggle in core and kernel | core `emboss.ts`, kernel `emboss.ts`, `sources.ts`, tests, `docs/file-format.md`, `pnpm api:generate` | S1, S2 | opencode DeepSeek | S3 tests; golden table unchanged |
| S4 | Several faces in core and kernel | core `emboss.ts` + face roles, kernel `emboss.ts`, tests, file format, api | S3 | Claude Opus | S4 tests; one-face names unchanged |
| S5 | Dialog: Faces, toggle, method line, arrow; unit tests | `apps/web/src/features/emboss.ts`, its test | S4 | opencode GLM | S5 tests; app run from the worktree for the owner |
| S6 | E2E and docs | `e2e/emboss.spec.ts`, e2e notes, digest, guide page, changelog, roadmap | S5 | Claude Sonnet | three specs green twice; CI by full SHA |

S1 and S2 can run in parallel (S1 doesn't touch the facade). S3 and S4 both edit
`kernel/src/features/emboss.ts`, so they run one after the other. Decisions 1.1,
2.1, 3.1 and 5.1 match the table as it is. Decision 4.1 means S4
clips only a several-face emboss. Six worker
slices of 1-3 h each, plus one OCCT CI build (~16 min) after S2.

## 11. Risks

- **The clip-mode thick piece of a partial sphere or torus** (a dome with a pole):
  the simple offset may refuse the pole. The harness case comes first; the fallback
  is the concentric shell `common` the face's column from the centre, in the facade.
- **Coincident-surface booleans**: tested for a cylinder (exact), not yet for a cone
  slab: in the S2 harness.
- **Names across pieces**: `#n` follows the pieces' order (the Faces list) and the
  fuse's sub-shape order, like a split's; a reordered Faces list renumbers them. The
  clip walls' `k` follows the list too.
- **Jogs and notches**: a letter across a sharp edge between a wrap and a flat face
  away from `s = 0` jogs; across a convex crease between two projected faces an
  emboss has a V-notch (the two offsets part). Documented, not fixed.
- **Speed**: each extra face adds a `common` and a fuse; a projected loft face was
  0.55 s alone (A4). Three projected faces with a text may take 1-2 s per recompute.
- **The fold's choice of turn** is the smallest one; for a sketch far off the face's
  tangent plane (XY text onto a wall) the text runs where the fold puts it (down the
  wall). With a line parallel to the face the toggle refuses rather than guess.
- **Older readers**: a several-face emboss is "Invalid inputs" there, a tangent one
  is computed without the toggle (and may be refused). Said in the file format.

## 12. Rejected

- **Anchor at the face's nearest point** (Tangent Plane's own point rule): depends on
  the distance, so a far sketch's off-centre text lands near the face's middle.
- **Tangent as an automatic fallback** where today's rules refuse: hidden, and the
  flip would change results nobody asked to change.
- **An "at point" placement** (a picked point, an angle, a flip handle): more UI
  than the item needs; possible later on top of the anchor.
- **Unrolling a smooth chain of faces** (text round a rounded box's corner onto the
  next side): the true development across faces; a bigger feature of its own.
- **Clipping in the sketch plane before wrapping** (the faces' outlines unrolled into
  the frame): more facade code than one `common` with the face's slab, which the
  spike shows exact.
- **A separate `faces` input beside `face`**: two inputs for one thing.
- **Clipping single-face embosses too**: changes existing documents.

## 13. ADR shape

A **second dated amendment of ADR-0060** (both items are its Deferred list; no new
number): B1 cone tangent planes, B2 tangent to the face (anchor, fold, flip,
method), B3 several faces (per face, clip, mixing rule, names, one face unchanged),
B4 facade, B5 results (harness numbers, WASM size), B6 still deferred (chain
unrolling, faces of several bodies, an at-point placement). Its rules go into the
ADR-0060 paragraph of `docs/agent/adr-digest.md`.

## 14. Owner's decisions

1. **"Tangent to the face"**
   1.1 **(recommended; chosen, owner, 2026-11-04)** The toggle of §4.2 plus the cone tangent planes of §4.1:
   any sketch angle, letters read the right way round from outside, centred straight
   in front of the text. Slices S1-S3.
   1.2 Only §4.1 (S1, TypeScript only, no facade): Tangent Plane → Sketch → Emboss
   works on cones; nothing else changes.
   1.3 Neither: tick the item off as covered by Tangent Plane + sketching on it
   (cones stay refused).
2. **How several faces combine**
   2.1 **(recommended; chosen, owner, 2026-11-04)** Each face as it would be alone, clipped to it; any projected
   face makes every curved face projected (§4.3): letters keep their width round a
   fillet and line up at the seams that matter.
   2.2 Always project onto all faces: simplest (no `faceSlab`), always lines up, but
   a cylinder in the set is projected (letters narrow) where one face alone wraps.
   2.3 Leave several faces out for now.
3. **Schema for several faces**
   3.1 **(recommended; chosen, owner, 2026-11-04)** Widen `face` to many: one field, old documents unchanged;
   an older Extrudo marks a several-face emboss "Invalid inputs".
   3.2 Keep `face` and add `moreFaces`: an older Extrudo embosses only the first face,
   with its unknown-input warning.
4. **One face stays unclipped**
   4.1 **(recommended; chosen, owner, 2026-11-04)** Yes: existing documents keep their geometry; only a
   several-face emboss stops at the faces' edges.
   4.2 Clip one face too: letters never hang past a face's edge, but existing
   documents change.
5. **Record**
   5.1 **(recommended; chosen, owner, 2026-11-04)** A second amendment of ADR-0060.
   5.2 A new ADR (number from `next-free --reserve`).
