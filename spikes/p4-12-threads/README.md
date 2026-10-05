# P4-12 thread harness

`harness.cpp` includes `packages/kernel/occt/facade/extrudo_facade.cpp` with
`#define private public` and builds B9's thread — the ISO 68-1 tooth, ring and
lead-ins of `features/thread.ts` — in the pinned opencascade.js image, to find
where a long thread stops being safe (ADR-0067 §H2, B9's fuzzing finding).

```sh
sh spikes/p4-12-threads/run.sh 400            # 400 turns, internal M20 (the default)
sh spikes/p4-12-threads/run.sh 400 0          # external
sh spikes/p4-12-threads/run.sh 600 1 D=20 P=2.5 TOL=0.1 LEAD=0
sh spikes/p4-12-threads/run.sh 600 1 CHUNK=20   # cut the tooth out in 20-turn pieces
sh spikes/p4-12-threads/bisect.sh 150 200 300 400 600   # one process per count
OCCT_DEBUG=1 sh spikes/p4-12-threads/run.sh 400 1   # -g2 -sNODERAWFS=1: names in the trace
```

Every step prints before it runs and the heap (`sbrk(0)`) after it, so a trap
names the call that caused it and the memory tells whether it ran out.