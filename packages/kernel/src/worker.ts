// Kernel Web Worker entry. Spawned by spawnBrowserKernel() (browser.ts).
import * as Comlink from 'comlink';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { meshBuffers } from './mesh';
import { loadOcct } from './occt/load';
import type { RecomputeResult } from './recompute/types';
import { type KernelApi, KernelService } from './service';

const service = new KernelService(() =>
  loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
);

/** The service, with mesh buffers transferred instead of copied. */
const api: KernelApi = {
  init: () => service.init(),
  recompute: async (request, onFeature) => transfer(await service.recompute(request, onFeature)),
  preview: async (request, onFeature) => transfer(await service.preview(request, onFeature)),
  endPreview: () => service.endPreview(),
  debugTestPart: async () => {
    const part = await service.debugTestPart();
    return Comlink.transfer(part, meshBuffers(part.mesh));
  },
  debugCrash: () => service.debugCrash(),
  stats: () => service.stats(),
};

Comlink.expose(api);

function transfer(result: RecomputeResult): RecomputeResult {
  if (result.status !== 'done') return result;
  const buffers = result.bodies.flatMap((body) => (body.mesh ? meshBuffers(body.mesh) : []));
  return Comlink.transfer(result, buffers);
}
