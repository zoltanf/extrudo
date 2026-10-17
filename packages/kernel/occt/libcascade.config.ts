// Extrudo's trimmed OCCT WASM build (ADR-0001), made with @libcascade/toolchain.
// Built by `pnpm occt build` (needs Docker and the pinned 2.4 GB
// ghcr.io/taucad/opencascade.js image, about 10 minutes), or downloaded by
// `pnpm occt ensure` from the GitHub release that CI publishes for the current
// inputs. See packages/kernel/occt/README.md.
//
// `bindings` lists only our C++ facade (facade/extrudo_facade.cpp). It owns all
// OCCT memory and does all the work: results, history and meshes are copied out
// once as flat arrays, and its public methods take and return ints, doubles and
// pointers, never OCCT types, so no raw OCCT class needs an embind binding
// (ADR-0037). The facade includes OCCT headers directly and links the static
// libraries. (It began as the way around 3.0.x's `delete()` leak,
// taucad/opencascade.js#40, fixed in toolchain 3.1.0.)
import { defineBuild } from '@libcascade/toolchain';

export default defineBuild({
  name: 'extrudo_occt',
  bindings: ['ExtrudoFacade'],
  customBindings: [{ file: 'facade/extrudo_facade.cpp', symbols: ['ExtrudoFacade'] }],
  settings: {
    // An ES-module factory; libcascade's assembled init.js imports the glue as ESM.
    MODULARIZE: true,
    EXPORT_ES6: true,
    ALLOW_MEMORY_GROWTH: true,
    // With -fwasm-exceptions the toolchain requires the three exception helpers.
    EXPORTED_RUNTIME_METHODS: [
      'FS',
      'wasmMemory',
      'getExceptionMessage',
      'incrementExceptionRefcount',
      'decrementExceptionRefcount',
    ],
    ENVIRONMENT: ['web', 'worker', 'node'],
    // No `eval`/`new Function` in the glue, so the app's content policy needs no
    // 'unsafe-eval' (ADR-0067 H1, ADR-0054). Embind then builds its invokers as
    // closures instead of evaluating them; the cost is measured in ADR-0067.
    DYNAMIC_EXECUTION: 0,
    // Emscripten's default stack is 64 kB, and OCCT outgrows it: a boolean on
    // B-spline faces needed more than that, and an optimised build has no
    // check, so the overflow wrote over static data and a later call trapped
    // (ADR-0001's amendment, 2026-10-11). The facade guards the stack's last
    // 64 kB and stops the module if anything reaches them.
    STACK_SIZE: '8MB',
  },
  compilerFlags: { exceptions: 'wasm', noEntry: true, simd: true, optimize: 'O3' },
  variants: [{ name: 'single' }],
});
