# P4-12 tapered threads: native facade harness

`harness.cpp` includes `packages/kernel/occt/facade/extrudo_facade.cpp` with
`#define private public` and drives `helixWire` on a cone, `threadFace` on
cones, `threadSweep` with a taper and an NPT 1/2 thread cut into a cone in the
pinned opencascade.js image (ADR-0056's third amendment).

```sh
bash spikes/p4-12-thread-taper/run.sh            # helix radii per turn, threadFace on cones, NPT 1/2 vs the straight thread at the mean diameter
bash spikes/p4-12-thread-taper/run.sh leaks 300  # heap top every 50 rounds of a tapered sweep and its cut
bash spikes/p4-12-thread-taper/run.sh compare    # straight threads built by this facade and by origin/main's (BASE=<ref>)
```

`build/` is the output (git-ignored).
