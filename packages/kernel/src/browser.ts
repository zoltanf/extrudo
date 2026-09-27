import * as Comlink from 'comlink';
import type { KernelConnection } from './client';
import type { KernelApi } from './service';

/** Starts the kernel in a module Web Worker. Pass this to `new KernelClient(…)`. */
export function spawnBrowserKernel(): KernelConnection {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'extrudo-kernel',
  });
  const api = Comlink.wrap<KernelApi>(worker);
  // Callbacks cross the worker boundary as proxies.
  // (A Comlink proxy has no own keys to spread, so every method is listed.)
  const proxied: KernelApi = {
    init: () => api.init(),
    recompute: (request, onFeature) =>
      api.recompute(request, onFeature && Comlink.proxy(onFeature)),
    preview: (request, onFeature) => api.preview(request, onFeature && Comlink.proxy(onFeature)),
    endPreview: () => api.endPreview(),
    debugTestPart: () => api.debugTestPart(),
    debugCrash: () => api.debugCrash(),
    stats: () => api.stats(),
  };
  return {
    api: proxied,
    terminate: () => {
      api[Comlink.releaseProxy]();
      worker.terminate();
    },
    onFatal: (listener) => {
      worker.addEventListener('error', (event) => {
        listener(new Error(event.message || 'the kernel worker failed'));
      });
    },
  };
}
