// Extrudo's trimmed OCCT WASM build (ADR-0001), made with @libcascade/toolchain.
// Built by `pnpm occt build` (needs Docker and the pinned 2.4 GB
// ghcr.io/taucad/opencascade.js image, about 10 minutes), or downloaded by
// `pnpm occt ensure` from the GitHub release that CI publishes for the current
// inputs. See packages/kernel/occt/README.md.
//
// `bindings` lists only our C++ facade (facade/extrudo_facade.cpp). It owns all
// OCCT memory and does all the work (taucad/opencascade.js#40), and its public
// methods take and return ints, doubles and pointers, never OCCT types, so no
// raw OCCT class needs an embind binding (ADR-0037). The facade includes
// OCCT headers directly and links the static libraries.
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
  },
  compilerFlags: { exceptions: 'wasm', noEntry: true, simd: true, optimize: 'O3' },
  variants: [{ name: 'single' }],
});
