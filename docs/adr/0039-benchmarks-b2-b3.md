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
