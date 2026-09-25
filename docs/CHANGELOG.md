# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

- 2026-09-25 · **P0-02** Kernel spike (`spikes/p0-02-kernel/`): libcascade,
  replicad and brepjs/occt-wasm compared on the same scenario in Node and a
  browser worker, with sizes, load times, op timings, a memory test and a
  topological-naming history test. ADR-0001: raw `libcascade` in our own thin
  wrapper. Found embind leaks in `BRepAlgoAPI_Cut` (fixed by `Clear()`) and
  `BRepFilletAPI_MakeFillet`.
- 2026-09-25 · **P0-01** Repo and toolchain: git, pnpm 12 monorepo (`apps/web`,
  `packages/{core,sketch,kernel,io,storage}`), TypeScript 7 strict, Biome 2.5,
  Vitest 5, Playwright 1.63, GitHub Actions CI, GPL-3.0 (+ MIT for `io`),
  package-boundary check, branded hello page.
