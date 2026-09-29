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
   the benchmark doesn't need.)
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
