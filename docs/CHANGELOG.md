# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

- 2026-09-25 · **P0-03** Solver spike (`spikes/p0-03-solver/`): planegcs in
  Node and the browser on a constrained rectangle and on generated 50–500-entity
  sketches; our own planegcs builds (the published one has a fixed 16 MB heap);
  per-component solving; SolveSpace (`slvs`) compared. ADR-0002: planegcs from
  our own build, one solver system per independent component, drag through
  temporary constraints on sketch parameters.
- 2026-09-25 · **P0-09** Kernel package: our trimmed OCCT WASM with a C++
  facade (shapes in an arena, flat result/history/mesh arrays, LGPL-2.1+),
  TS `Kernel` layer, Comlink worker, `KernelClient` that restarts the worker
  after a WASM abort, debug page `#/debug/kernel` rendering the test part.
  Memory test (1000 rebuilds + a leak control) and crash test in Vitest and
  Playwright. CI builds the WASM once per input hash and publishes it as a
  release (`pnpm occt ensure` downloads it).
- 2026-09-25 · **P0-02** Kernel spike (`spikes/p0-02-kernel/`): libcascade,
  replicad and brepjs/occt-wasm compared on the same scenario in Node and a
  browser worker, with sizes, load times, op timings, a memory test and a
  topological-naming history test. Built our own trimmed libcascade WASM
  (4.34 MB brotli, about 200 ms cold start). Found that libcascade's `delete()`
  often doesn't free C++-owned memory. ADR-0001: own trimmed build + a C++
  facade that owns memory + a thin TS layer.
- 2026-09-25 · **P0-01** Repo and toolchain: git, pnpm 12 monorepo (`apps/web`,
  `packages/{core,sketch,kernel,io,storage}`), TypeScript 7 strict, Biome 2.5,
  Vitest 5, Playwright 1.63, GitHub Actions CI, GPL-3.0 (+ MIT for `io`),
  package-boundary check, branded hello page.
