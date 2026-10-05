import * as Comlink from 'comlink';
import type { KernelConnection } from './client';
import type { KernelApi } from './service';

/** Starts the kernel in a module Web Worker. Pass this to `new KernelClient(…)`. */
export function spawnBrowserKernel(): KernelConnection {
  return connect(
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'extrudo-kernel' }),
  );
}

/**
 * The dialog debug page's kernel (`#/debug/dialog`): the app's kernel plus
 * the engine's test feature types (`debug-worker.ts`). Not for projects.
 */
export function spawnDebugKernel(): KernelConnection {
  return connect(
    new Worker(new URL('./debug-worker.ts', import.meta.url), {
      type: 'module',
      name: 'extrudo-kernel-debug',
    }),
  );
}

function connect(worker: Worker): KernelConnection {
  const api = Comlink.wrap<KernelApi>(worker);
  // Callbacks cross the worker boundary as proxies.
  // (A Comlink proxy has no own keys to spread, so every method is listed.)
  const proxied: KernelApi = {
    init: () => api.init(),
    addFont: (id, bytes) => api.addFont(id, bytes),
    addFile: (id, bytes, mediaType, fileName) => api.addFile(id, bytes, mediaType, fileName),
    enableMeshes: () => api.enableMeshes(),
    enableOpenscad: () => api.enableOpenscad(),
    recompute: (request, onFeature) =>
      api.recompute(request, onFeature && Comlink.proxy(onFeature)),
    preview: (request, onFeature) => api.preview(request, onFeature && Comlink.proxy(onFeature)),
    endPreview: () => api.endPreview(),
    reference: (body, kind, index, base) => api.reference(body, kind, index, base),
    tangentChain: (body, index, base, kind) => api.tangentChain(body, index, base, kind),
    exportMeshes: (bodies, tessellation, onProgress) =>
      api.exportMeshes(bodies, tessellation, onProgress && Comlink.proxy(onProgress)),
    exportStep: (bodies) => api.exportStep(bodies),
    inspect: (targets) => api.inspect(targets),
    debugTestPart: () => api.debugTestPart(),
    debugCrash: () => api.debugCrash(),
    stats: () => api.stats(),
    heap: () => api.heap(),
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
