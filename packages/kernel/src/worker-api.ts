import * as Comlink from 'comlink';
import { meshBuffers } from './mesh';
import type { RecomputeResult } from './recompute/types';
import type { KernelApi, KernelService } from './service';

/**
 * A worker's RPC surface over a `KernelService`: the service itself, with
 * mesh buffers transferred instead of copied. Shared by the app's kernel
 * worker and the dialog debug page's (`debug-worker.ts`).
 */
export function workerApi(service: KernelService): KernelApi {
  return {
    init: () => service.init(),
    recompute: async (request, onFeature) => transfer(await service.recompute(request, onFeature)),
    preview: async (request, onFeature) => transfer(await service.preview(request, onFeature)),
    endPreview: () => service.endPreview(),
    reference: (body, kind, index, base) => service.reference(body, kind, index, base),
    debugTestPart: async () => {
      const part = await service.debugTestPart();
      return Comlink.transfer(part, meshBuffers(part.mesh));
    },
    debugCrash: () => service.debugCrash(),
    stats: () => service.stats(),
  };
}

function transfer(result: RecomputeResult): RecomputeResult {
  if (result.status !== 'done') return result;
  const buffers = [
    ...result.bodies.flatMap((body) => (body.mesh ? meshBuffers(body.mesh) : [])),
    ...(result.tools ?? []).flatMap((tool) => meshBuffers(tool.mesh)),
    ...(result.base ?? []).flatMap((body) => (body.mesh ? meshBuffers(body.mesh) : [])),
  ];
  return Comlink.transfer(result, buffers);
}
