# ADR-0039: Benchmarks B2 and B3 as UI specs and fixtures

- **Status:** Accepted, 2026-09-29
- **Task:** P2-17 (benchmarks B2 and B3, requirements §7). Code:
  `e2e/benchmark-b2.spec.ts`, `e2e/benchmark-b3.spec.ts`,
  `e2e/benchmark-helpers.ts`, `fixtures/benchmarks/*.extrudo`,
  `packages/kernel/src/benchmarks.test.ts`,
  `packages/storage/src/fixtures.test.ts`.
- **Builds on:** ADR-0028 (extrude operations), ADR-0031 (sketch on face,
  Project), ADR-0034 (3MF and STL export), and P1-15's B1 spec.
- **Affects:** P3-06 (Combine), every later benchmark (B4 to B10), P3-14
  (the 3MF-in-a-slicer check).

## Context

Requirements §7: every release must build the benchmark models from
scratch, fully parametric, and they double as end-to-end fixtures. B1 was
built through the UI in P1-15. v0.2 adds B2 (a storage box cut from a
solid) and B3 (a phone stand: revolve or extrude, several bodies,
combine).

## Decisions

1. **Both benchmarks are built through the UI**, as B1 is: user parameters
   in the Parameters dialog, sketches drawn with grid-snapped clicks,
   dimensions typed as parameter expressions, extrude dialogs filled with
   expressions. The specs then change parameters and read the model back
   (`data-bodies`, timeline chips) and the 3MF and STL files through
   `@extrudo/io` (closed, manifold, size and volume exact for the
   parameters; the box's volume is the block less the cavity, to 0.5 mm³).
2. **B2 uses Project and four dimensions, not Offset.** The inner outline
   is a rectangle whose four sides are each `wall` from the projected top
   face, as dimensions. Offset on the projected outline was tried first
   and offsets one line only: projected curves are separate entities that
   aren't joined by coincident constraints, and `chainOf` follows those.
   (Left as is: joining a projected face's outline is a change to ADR-0031
   the benchmark doesn't need.) **Superseded in P3-17:** `chainOf` now joins
   projected curves that end in one place, so B2 projects the outline and
   offsets it inward (Offset, 3 mm, the first dimension edited to `wall`);
   see the amendment at the end. The fixture was rewritten.
3. **B3 combines by a join that bridges two bodies.** There is no Combine
   feature before P3-06. The base plate and the back rest are two bodies
   (new-body extrudes); a strip sketched on the base's top face and
   extruded with Join touches both, and join's automatic targets fuse
   every body it touches, so they become one (body count 2, then 1). The
   standalone Combine step of B3 (join, cut or intersect two existing
   bodies by picking them) comes with P3-06, which should extend
   `e2e/benchmark-b3.spec.ts`.
4. **A phone stand hangs from the origin by a fixed point.** The origin is
   no sketch entity, but a point placed there snaps as `origin` and is
   fixed (`inference/constraints.ts`); the back rest's corner is
   dimensioned from it by `setback` and `base`, so it rides up with the
   base's thickness.
5. **Fixtures are files the app exported.** The specs export the finished
   design from File › Export .extrudo, and `WRITE_FIXTURES=1 pnpm e2e`
   (or the single spec) writes it to `fixtures/benchmarks/<name>.extrudo`
   (B1's is written too). Nothing hand-made: a format change that needs a
   migration shows up as a fixture that loads with `migrated: true`
   (`packages/storage/src/fixtures.test.ts` expects none), and the files are
   regenerated in the same commit.
6. **The kernel test recomputes the fixtures headless**: load through
   core's migrations, run the recompute engine with the real kernel, expect
   the bodies, faces, size and volume, then change parameters the extrudes
   read (`height`, `width`, `brace`) and expect the sizes to follow. Vite
   inlines the binary files (`import f from '…extrudo?url&inline'`, a
   `data:` URL) so the packages that have no Node types can read them.

## Rejected

- **Changing sketch parameters in the headless test.** A dimension's value
  moves the sketch's stored curves only through the app's `ToolHost.apply`
  (ADR-0016, which re-solves); the kernel builds what is stored. Those
  parameters (`width` of B2's rectangle, `tilt`, `rise`) are changed in the
  e2e specs, where the app re-solves.
- **Hand-written fixture JSON.** It wouldn't test what the app writes.
- **A Playwright download per test run into the repo**: only with
  `WRITE_FIXTURES`, so a normal run leaves the work tree alone.

## Consequences

- Each spec takes about 20 s alone (B3 about 30 s), and the full suite
  gains about a minute.
- A change to the Extrude dialog's field names, the sketch palette or the
  Project tool's behaviour breaks these specs first, which is the point.

## Amendment 2026-09-30: B4, B5 and B7 (P3-14)

Code: `e2e/benchmark-b4.spec.ts`, `-b5`, `-b7`, new steps in
`e2e/benchmark-helpers.ts` (`turnView`, `clickEdge`, `pickAxis`,
`primitive`, `ok`, `renameBody`, `extentOf`, `solidTab`…), fixtures
`b4-box-with-lid`, `b5-pcb-enclosure`, `b7-knurled-knob`, and their headless
recompute in `packages/kernel/src/benchmarks.test.ts`. B6 (wall hook:
fillets on intersecting edges, draft) waits for Draft (P3-08).

1. **B4 and B5 start from primitives, B7 from a sketch.** A Box or Cylinder
   dialog takes parameter expressions directly (`length - 2 * (wall +
   clearance)`), so the specs skip sketching and dimensioning where the
   benchmark doesn't exercise them, stay near 30 s, and the headless test
   can change every parameter (nothing waits for the app's re-solve).
   B7 needs a profile to revolve: a rectangle from the origin with two
   dimensions on XZ (sketch x is world X, y is world Z; camera direction
   `0,1,0`).
2. **B4 checks the fit, not just sizes.** The lid is a plate on an offset
   plane at `height` (a body of its own) and a lip joined under it, the
   cavity less `clearance` on each side. The e2e reads the 3MF: the lid's
   nodes below the rim are the lip, the box's nodes above the floor and
   inside the walls the cavity; the gap on each side is the clearance,
   before and after `clearance` and `length` change. The headless test
   measures it exactly: the box and the lid share no volume, and lifted
   1 mm off the rim the lid is `clearance` from the box (the lip's
   tightest side).
3. **B5's lid holes are blind, as deep as the lid, with a flat point.**
   "Through all" runs past every body and cuts every body it touches, so
   it would drill the posts and the floor below the lid (a hole has no
   "this body only"; noted for P3-17/P4-12). The countersink comes from
   the M3 clearance preset, the posts' holes from the M3 heat-set insert
   preset.
4. **Posts by a 2 × 2 rectangular pattern, lid holes by two holes and a
   Mirror.** A pattern or mirror replays extrudes, revolves, primitives
   and holes, not other patterns or mirrors (`PATTERNABLE_FEATURE_TYPES`),
   so one mirror of one hole makes two corners, not four.
5. **The headless box is the display mesh's.** `measure()`'s box is loose
   (about 0.02 mm more around shelled and curved bodies); the mesh's nodes
   lie on the exact vertices. B2 and B3 give the same numbers either way.
6. **B7's grooves stay clear of the chamfer's inner edge.** A groove as
   deep as the chamfer is wide (radius = `bevel`) touches the edge and
   splits the chamfer face once per groove (58 faces instead of 41 for 18
   grooves). That's right geometry, not a bug; the parameter change uses a
   1.8 mm groove.

Rejected: zooming out until the YZ plane's square clears the enclosure to
pick it for the Mirror (a dozen wheel steps; hiding the lid shows the
square over the open tray, two clicks); B4 and B5 from sketches (slower,
and their sketch dimensions couldn't change in the headless test).

Each spec takes 25 to 30 s alone on the Arch workstation (up to about
39 s for B5 beside another spec); the 3MF exports of all three are
manifold in PrusaSlicer (`prusa-slicer --info`).

## Amendment (P3-17)

B2 projects the top face's outline and offsets it inward with the Offset tool
(a typed 3 mm, then the first of the four distances edited to `wall`; the other
three follow it) instead of a rectangle with four dimensions, now that Offset
follows a projected outline (ADR-0031 amendment). Same faces, sizes and
volumes; the fixture `fixtures/benchmarks/b2-storage-box.extrudo` was written
again (`WRITE_FIXTURES=1`), and the fuzzer (200 steps) is still clean on it.

## Amendment 2026-10-04: B9 (P4-11)

Code: `e2e/benchmark-b9.spec.ts`, the fixture
`fixtures/benchmarks/b9-bottle-cap.extrudo` and its headless recompute in
`packages/kernel/src/benchmarks.test.ts`. B8 (emboss/deboss) waits for P4-04,
B10 (tolerance) for P4-08.

1. **The model.** Parameters `capDia` 32 mm, `capHeight` 14 mm, `wall` 2 mm,
   `adapterLow` 20 mm, `stepHeight` 10 mm. The cap is Sketch1 on XZ — a
   rectangle from the origin, `capDia / 2` by `capHeight` — revolved a whole
   turn about Z, shelled open at its bottom face `wall` thick inside (5 faces:
   the cup is open below and **closed at the top**, so it is a cap, not a
   cup), and Thread1 cuts an M30 into the Ø28 bore. The adapter is Sketch2 on
   XZ below it — six lines drawn on 10 mm grid points and dimensioned with the
   parameters from a fixed point at the sketch origin, 5 dimensions, "Fully
   constrained" — revolved as a body of its own, and Thread2 threads both
   outside walls (M20 on the Ø20 spigot, M24 on the Ø28 collar). Both threads
   are `auto`: the kernel fits each face.
2. **The section is dimensioned from the origin point, like B3's.** Two
   two-point dimensions from the fixed point at (0, 0) (one vertical, one
   horizontal, chosen by where the label is placed) put the profile's lowest
   corner, then the two steps' lengths and the top edge's width fix it: **five
   dimensions are exactly enough** — a sixth (the top edge as a distance from
   the origin's axis as well) is refused as over-constraining.
3. **What was hard through the UI** (each cost a run):
   - **The shell's inside is only visible from below.** The cup is closed at
     the top, so from the home view every pick inside it hits the flat top
     face and the Thread dialog answers "Pick round faces: a shaft's side or a
     hole's wall". Turn to the bottom view and pick the wall itself — a point
     inside the hollow picks the lid above it.
   - **The bottom face needs the bottom view too** (it is the one face the cap
     hides from every oblique view).
   - **A dimension's orientation comes from where its label is placed**: above
     or below a slanted pair measures x, beside it measures y. The label's
     click must land on empty space *and on screen* — the sketch's own fit is
     32 mm tall and the profile reaches 30 mm below the cap, so the spec zooms
     out around the middle of the view (a point of the model can be under the
     floating palette) before drawing.
   - **The body's names are not Body1, Body2**: after the cap's row is renamed
     the free name `Body1` is the adapter's.
   - The adapter's two walls are picked in the front view (in the home view
     the spigot's far side is hidden behind the collar).
4. **What the benchmark found**, and what came of it (all of it in
   modeled threads, ADR-0056):
   - **`autoThread` had no ISO coarse thread for a bore wider than M30.** It
     fits a hole only when the thread's major diameter is *larger* than the hole
     (that is what makes a tap-drill hole find its thread), and the coarse
     series stopped at M30, so the cap at `capDia` 40 mm — a Ø36 bore — had no
     fit: "Thread1 (error)" and an error in the status bar. **`METRIC_COARSE`
     now goes to M64** (ISO 261: M33 × 3.5, M36 × 4, M39 × 4, M42 × 4.5,
     M45 × 4.5, M48 × 5, M52 × 5, M56 × 5.5, M60 × 5.5, M64 × 6; ISO 261's
     M55 is left out, M56 is the size in use), so the parameter change is the
     one the benchmark was designed for: `capDia` 40 mm and `adapterLow` 24 mm
     refit every thread (M39 in the cap's Ø36 bore, M24 on the spigot, M36 on
     the Ø36 collar) and the two parts' threads mesh. A Ø36 bore and a Ø40
     shaft fit, and `autoThread` still refuses a hole or a shaft far off the
     series.
   - **A thread of the ~400 turns `MAX_TURNS` allowed corrupted the WASM
     heap.** The fuzz run found it (B9 step 8 at seed 20260987: `capHeight` ×
     100, a 1.4 m cap, ~400 turns of M30): `RuntimeError: table index is out
     of bounds`, and later features in the same process read freed memory
     ("Mesh failed: <garbage>"). **~200 turns is fine** (40 s), 400 fails the
     boolean or traps the heap. `MAX_TURNS` is **150** now (about 15 s of
     booleans, ADR-0056's 0.1 s a turn) and a thread that long is refused with
     the wording it always had ("The thread would have 400 turns; up to 150 can
     be modeled. Make it shorter or the pitch larger."), before anything is
     built. Replaying that exact fuzz document now ends in the refusal. The
     corruption itself was a P4-12 item; **ADR-0067 §H2 (2026-10-05) bisected
     it natively**: it is OCCT's ring − tooth boolean running out of memory
     (403 MB → 1903 MB of malloc at 350 turns, more than the 2 GB a WASM
     module can grow to at 400), not a bug — the tooth is now cut out of the
     ring in pieces of `THREAD_CHUNK` turns, so 400 and 600 turns build and no
     turn count can trap. `MAX_TURNS` stays 150, which is now about the time a
     thread takes (a piece-wise cut is 0.35 s a turn).
   - **`mergeTools` asks for the exact distance between two thread tools, and
     that is slow**: `capDia` × 2 puts the adapter's collar at Ø60, and the
     `BRepExtrema_DistShapeShape` between the M20 and the M60 tool took 26 s of
     the 30 s recompute. It is why B9 got 6 fuzz steps instead of 200 (and a
     45 s step limit): a thread-heavy document is expensive to fuzz, and the
     exact-distance test was the reason. **ADR-0067 §H2 (2026-10-05) fixed
     that**: two tools whose boxes overlap are merged without the distance when
     either is heavy (over `HEAVY_TOOL_FACES` faces), light tools still get the
     exact test, and B9 fuzzes in the default run again at 200 steps with a
     60 s step limit. (B9's own threads are a few turns each, so they are light
     and cheap: its `capDia` × 2 recompute is 8 s cold and 14 ms warm today,
     before and after the rule. The 277 s call it stands for is between tools
     of 36 and 30 turns.)
5. **Threads take a third of a body's matter.** The cap's internal thread
   leaves 89 % of the unthreaded cup; the adapter's two threads turn it down to
   their crests (M20 → Ø19.8, M24 → Ø23.8, so the Ø28 collar as drawn is
   Ø23.8 in the model) and leave 68 %. The spec checks the cap between 80 % and
   100 % of the exact cup and the adapter between the cylinders its roots and
   crests make, which is what the ISO profile bounds exactly. After the
   parameter change the cap's bore is Ø36 with an M39 thread in it and the
   adapter's collar Ø36 with M36 (crests Ø38.8 and Ø35.8 across).

The spec takes about 50 s alone on the Arch workstation (four thread builds and
two 3MF exports); the headless recompute is 7 s, and B9's 6 fuzz steps 91 s.

## Amendment 2026-10-04: B8 and B10 (P4-11, part 2)

Code: `e2e/benchmark-b8.spec.ts`, `e2e/benchmark-b10.spec.ts`, the fixtures
`fixtures/benchmarks/b8-name-tag.extrudo` and `b10-chain-link.extrudo`, and
their headless recompute in `packages/kernel/src/benchmarks.test.ts`. With
these two, P4-11 (B8 to B10) is done.

### B8, the name tag

1. **The model.** Parameters `length` 60 mm, `width` 20 mm, `thick` 3 mm,
   `corner` 5 mm, `letters` 1 mm. Box1 on XY; Fillet1 on its four **vertical**
   edges; Hole1 through the top face, Ø4 mm, its X the expression
   `-length / 2 + 6 mm`; Sketch1 **on the top face** with a text `EXTRUDO`,
   8 mm of cap height, centred, at an anchor of (4, -4) sketch mm; Emboss1 of
   the whole text onto that same face, `letters` out. The letters stand 1 mm
   proud of the plate, so the body is `length` x `width` x (`thick` +
   `letters`).
2. **The text is centred on x = 4, not x = 5.** `EXTRUDO` at an 8 mm cap height
   is 50.8 mm wide in Inter, so centred on x = 5 it reaches x = 30.3 and the
   last letter overhangs the plate's far end by 0.3 mm (one body, but a letter
   hanging over nothing). Centred on x = 4 it fits between the hole's edge
   (-`length` / 2 + 8 = -22) and the plate's end (30), which is what
   "centred on the plate's right half" has to mean at this size. The spec
   asserts both edges and reads the ink's bounds.
3. **A plate this thin hides one corner from any one view.** The four vertical
   edges are 3 mm long: the home view reaches three of them (the far left one
   is behind the slab) and the back view (Shift+5) the fourth, so Fillet1 takes
   three picks from one view and one from the other. **The first pick has to be
   made at the fitted zoom**: after zooming out far enough to clear the dialog
   on the right, the display mesh's *own* vertices along a 3 mm edge are inside
   the 8 px vertex tolerance and take the click, and the dialog's edge filter
   only excludes them once it is open. The pattern the other specs use
   (`clickEdge` on a midpoint) works on B4's 60 mm edges and on these only at
   the fitted zoom.
4. **A text sketched on the face it lands on is pickable**, which is what makes
   this benchmark the easy one: `pickStack` ranks a whole text (-1) before a
   face (1) for coplanar hits, so a click on a letter takes `sketchEntity:
   <sketch>/<text>` and the Emboss tool's pre-selection fills `Profiles` with
   "1 text". P4-04's emboss spec sketches its text on a construction plane
   clear of the body because it has to *click* the letters; a name tag has them
   in the right place already.
5. **What the benchmark found:** nothing to change. The ink's own proportion
   (32 % of its bounding box) is what bounds the 3MF volume check; the hole
   expression moving with `length` is what makes the parameter change move it.

### B10, the cable chain link

1. **The model.** Parameters `pitch` 30 mm, `inner` 20 mm, `wall` 3 mm,
   `depth` 10 mm, `pin` 5 mm, and a print tolerance of 0.2 mm from the 3D Print
   tab's panel (which creates the parameter `tolerance`). Sketch1 on XZ: the
   walls' centreline, a rectangle from (-(inner + wall) / 2, wall / 2) to
   ((inner + wall) / 2, inner + wall / 2), its four corners rounded 3 mm with
   the sketch fillet (a radius typed in the heads-up box first, so all four come
   out the same). Sketch2 on YZ: the section, `depth` by `wall`, centred on
   the path's own centreline. Sweep1 along all eight curves of the path
   (follow), a new body. Cylinder1 on the link's outside face at the top of its
   frame: `pin` across, 3 mm out, join. Hole1 on the opposite side face at the
   other end: blind, `wall` deep, `pin + 2 * tolerance` across. Rectangular
   Pattern1 of the Link body: three links along Y, `pitch` apart.
2. **A sweep carries the profile exactly where its sketch drew it.** ADR-0055
   says the profile "need not touch the path", and that is true — but *where
   it is drawn is where it is swept*: `pipe.Add(section, /*WithContact*/ false)`
   leaves OCCT's `GeomFill_SectionPlacement::Transformation` on its
   `P.SetCoord(0., 0., 0.)` branch, which cancels the law's own placement
   exactly. So a section has to be **centred on the path**, not merely near it.
   B10 drew it first centred on the YZ sketch's origin (1.5 mm off the
   centreline) and got a link with **6 mm walls**: a box of 29 x 10 x 26 mm
   and a volume 11.7 % over the centreline's perimeter times the section, while
   the straight walls' inner faces sat exactly on the path. Centred on the
   path's own line the ring is exact — 26 x 10 x 23 mm and 2425.5 mm³ against a
   perimeter of 80.85 mm times the 30 mm² section. (The headless test checks
   that number to 0.01 mm³.) **ADR-0055's Deferred should say this: a swept
   section's position is its own, and the dialog or the field hint should say
   "centred on the path".**
3. **The path is picked curve by curve, and the order matters.** The facade's
   `pathWire` builds the wire "with the first piece in its own direction", so
   the first curve picked is where the sweep starts: the spec picks the bottom
   line first (its tangent is along X, which the section's plane is square to).
   Every pick has to be at least 5 mm off Sketch2's own curves, which come
   first in the pick (both are sketch curves, nearest first), and the *profile*
   is picked in the half of Sketch2 that the path is not in front of: from the
   home view (camera at +X, -Y, +Z) the ray meets the YZ plane before the XZ one
   for a point at negative y, so a click at y > 0 takes the path's own region.
4. **A side face is picked in the view that looks square at it.** The plane
   picker (`sketchTargetAt`) takes an origin plane unless the face is *at least
   as near*, and in an oblique view an origin plane lies in front of a vertical
   face — so the hole's plane came out "YZ plane" however exactly the spec
   clicked. The front view (Shift+4) looks along the face's normal, with the
   XZ plane behind it. The pin's +Y face is picked in the back view for the
   same reason.
5. **A hole on a picked face defaults to `through`**, so the blind hole has to
   set Extent before its Depth field exists.
6. **What the benchmark found, and what came of it:** the model as specified is
   a chain link whose pin does not fit its own hole: Ø(`pin` + 2 x tolerance) =
   5.4 mm is wider than the 3 mm wall it is drilled into, so the hole severs the
   end wall where it is made (the link stays one solid, through its left and
   right walls, and its face count drops from 32 to 26 as the hole grows). A
   printable link needs `wall` >= `pin`; nothing was changed for it, since the
   benchmark is the model as requirements §7 describes it. The pattern's copy
   bodies are named from their instance (`Body1`, `Body2`, P3-07), not
   `Body2`, `Body3`.

Both specs take 19 s (B8) and 31 s (B10) alone on the Arch workstation; the
headless recompute is under a second each, and the fuzzer's 200 steps take 70 s
(B8) and 14 s (B10) — neither needed B9's reduced budget.
