# Extrudo's planegcs WASM

Our own build of [planegcs](https://github.com/Salusoft89/planegcs) (FreeCAD's
PlaneGCS sketch solver compiled to WASM), which the sketch solver adapter in
`../src/solver/` drives. The decision and its measurements are in
[ADR-0002](../../../docs/adr/0002-sketch-solver.md); the adapter is
[ADR-0011](../../../docs/adr/0011-sketch-solver-adapter.md).

| Path | What |
|---|---|
| `build.sh` | Clones planegcs at the pinned commit, generates its C++ bindings (in a Node 20 container), applies the patch, compiles with the pinned emsdk image. About two minutes the first time. |
| `Dockerfile` | The toolchain: `emscripten/emsdk:6.0.10` plus Eigen and Boost. |
| `planegcs.patch` | Our changes to planegcs's C++ (below). LGPL-2.1-or-later, like planegcs. |
| `planegcs.mjs` | Build, publish and download (below). Run it as `pnpm planegcs <command>` from the repo root. |
| `dist/` | The build output (gitignored): `planegcs.{js,wasm,d.ts}` and planegcs's `LICENSE`. |

The JS side (the `GcsWrapper` class and the primitive types) comes from the
`@salusoft89/planegcs` npm package at the same version (1.2.0); only the WASM
is ours. The adapter imports the wrapper by deep path, so the package's own
WASM never ends up in a bundle.

## The patch

- `ALLOW_MEMORY_GROWTH`: the published build has a fixed 16 MB heap and aborts
  at about 100 entities in one system.
- `-msimd128` with the current emsdk: 10–17% faster on coupled systems.
- DogLeg's Gauss step uses `LeastNormLdlt` (a FreeCAD option) instead of
  `FullPivLU`, and the SQP step's QR (`qp_eq`) pivots columns instead of fully:
  another 1.4–1.6× on large components. Both still solve the test sketches to
  the same geometry as the published build (P0-03, within 1e-11 mm).
- `GcsSystem::get_dependent_params()` in the bindings (P1-08, ADR-0017): the
  indices of the unknowns the last diagnosis found not fully constrained,
  for the per-entity constraint colours.

## Getting the WASM

You normally don't build it. `pnpm check`, `pnpm dev` and `pnpm build` run
`pnpm wasm`, which runs `pnpm planegcs ensure`: it compares
`dist/.inputs-hash` with a hash of `build.sh`, `Dockerfile` and
`planegcs.patch` and, if they differ, downloads the matching build from the
GitHub release `planegcs-<hash>` (with `gh` while the repo is private).

CI publishes that release: the `planegcs` job in `.github/workflows/ci.yml`
builds each new input hash once. The shared logic is `scripts/wasm-release.mjs`
(the OCCT build uses it too).

## Changing the build

Edit the inputs, then build locally (Docker; until the next login after being
added to the `docker` group, through `newgrp docker`):

```sh
pnpm planegcs build
```

The clone and the build tree live in `../node_modules/.cache/planegcs-build/`,
out of reach of Vitest, Biome and tsc (the clone has tests of its own). Then
push; CI builds and publishes the new hash before the tests run.

- `build.sh` runs under bash with `pipefail`: an earlier `make | grep` hid a
  failed build once (an intermittent failure in the `LibsModule` target that
  a rebuild didn't reproduce). The full make log is in `build/planegcs/build.log`.
- The bindings generator needs tree-sitter, which doesn't build on Node 26,
  hence the Node 20 container.
- Vite warns that the glue's `import("node:module")` was externalized; that
  branch only runs under Node.
