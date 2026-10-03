# P4-02 thread facade harness

`harness.cpp` includes `packages/kernel/occt/facade/extrudo_facade.cpp` with
`#define private public` and drives `threadSweep`, `threadFace` and the
booleans natively in the pinned opencascade.js image (ADR-0056).

```sh
sh spikes/p4-02-harness/build.sh      # external/internal M3, M8, M20, M30: times, volumes, validity
sh spikes/p4-02-harness/build.sh 7    # threadFace on a shaft, holes, a shoulder; sweep history
sh spikes/p4-02-harness/build.sh 5    # where a ring - tooth boolean's time goes
```

`h.cjs` is rebuilt only when the harness or the facade changed.
