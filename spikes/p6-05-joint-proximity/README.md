# P6-05 J3: pose proximity (native harness)

Times the facade's `proximityOpen`/`proximityPose`/`proximityClose` against the
old path (`transform` + `distance` per pose) on the hinge of
`packages/kernel/src/joints/testing.ts`, at the poses its whole-turn clearance
check measures (ADR-0081's J3 amendment).

1. Dump the shapes and poses: copy `dump.test.ts` into
   `packages/kernel/src/joints/` and run
   `pnpm vitest run packages/kernel/src/joints/dump-proximity` from the repo
   root (it writes `data/*.step` and `data/poses.txt`; delete the copy after).
2. `bash spikes/p6-05-joint-proximity/run.sh plain` (11 + 11 faces) or `busy`
   (the ribbed hinge, 137 + 129 faces): prints the old and new totals and the
   largest difference between the two distances. A third argument `v` prints
   every pose.
3. `run.sh plain 300` opens, measures 20 poses and closes 300 times and prints
   the heap's growth (`sbrk`); `run.sh plain 300 leak` leaves the sessions open
   (the leak control: about 84 MB).
