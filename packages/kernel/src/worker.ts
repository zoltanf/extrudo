// Kernel Web Worker entry. Spawned by spawnBrowserKernel() (browser.ts).
import * as Comlink from 'comlink';
// manifold-3d's WASM (P4-06, ADR-0066 §3), a build asset: only a design with a
// mesh body downloads it (the app calls `enableMeshes` before that recompute).
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { loadOcct } from './occt/load';
import { KernelService } from './service';
import { workerApi } from './worker-api';

const service = new KernelService(
  () => loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
  { manifold: { wasmUrl: manifoldWasmUrl } },
);

Comlink.expose(workerApi(service));
