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
  return {
    api: api as unknown as KernelApi,
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
