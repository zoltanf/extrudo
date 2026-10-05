/**
 * manifold-3d, the mesh kernel mesh bodies live in (P4-06, ADR-0066 §3;
 * `packages/kernel/src/kernel.ts` owns the handles). **It loads only when a
 * document needs it**: `KernelService.enableMeshes` (called by the
 * `Recomputer` before the first recompute or preview with a mesh `import`)
 * loads the module in the worker, and `loadManifold` does it in Node. A
 * design without a mesh body downloads a second WASM no earlier.
 *
 * The module is Apache-2.0 and loaded from our own build output: the glue and
 * its `.wasm` are assets (see ADR-0066's Results for the precache decision
 * and the CSP: it needs nothing beyond what OCCT's own glue already has).
 */
import type { ManifoldToplevel } from 'manifold-3d';

export interface ManifoldLoadOptions {
  /**
   * URL of manifold-3d's `.wasm`. Required in a bundled browser build (the
   * worker imports it with `?url`); Node finds it next to the glue by itself.
   */
  wasmUrl?: string;
}

/**
 * Instantiates manifold-3d (about 100 ms) and calls its `setup`, which is
 * what binds the `Manifold` and `Mesh` classes onto the returned module.
 */
export async function loadManifold(options: ManifoldLoadOptions = {}): Promise<ManifoldToplevel> {
  const { default: factory } = await import('manifold-3d');
  const { wasmUrl } = options;
  // manifold-3d's glue takes a `locateFile` with no argument: it asks for the
  // one file it has, the .wasm next to the glue.
  const module = await factory(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  module.setup();
  return module;
}

export type { Manifold, Mat4, Mesh as ManifoldMesh } from 'manifold-3d';
/** The manifold-3d module, without loading it (types only). */
export type { ManifoldToplevel };
