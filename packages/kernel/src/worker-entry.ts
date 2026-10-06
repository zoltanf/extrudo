/**
 * `@extrudo/kernel/worker`: what a kernel Web Worker runs. The kernel's own
 * entry (`worker.ts`) calls it with nothing; the app's (`apps/web/src/project/
 * kernelWorker.ts`) gives it the script runner (P5-02, ADR-0070 §2), which
 * `@extrudo/kernel` may not import, as a loader that runs the first time a
 * design with a script recomputes.
 */
import * as Comlink from 'comlink';
// manifold-3d's WASM (P4-06, ADR-0066 §3), a build asset: only a design with a
// mesh body downloads it (the app calls `enableMeshes` before that recompute).
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { loadOcct } from './occt/load';
import type { ScriptHostLoader } from './script-host';
import { KernelService } from './service';
import { workerApi } from './worker-api';

export interface ServeKernelOptions {
  /** Loads the script runner; without one a Script feature is an error. */
  scripts?: ScriptHostLoader;
}

/** Starts the kernel service in this worker and answers the UI thread. */
export function serveKernel(options: ServeKernelOptions = {}): void {
  const service = new KernelService(
    () => loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
    {
      manifold: { wasmUrl: manifoldWasmUrl },
      // Shared by the debug and project entries; OpenSCAD stays lazy in a nested worker.
      openscad: async () => (await import('@extrudo/openscad/browser')).createBrowserCompiler(),
      ...(options.scripts && { scripts: options.scripts }),
    },
  );
  Comlink.expose(workerApi(service));
}
