// Kernel Web Worker entry. Spawned by spawnBrowserKernel() (browser.ts).
import * as Comlink from 'comlink';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { meshBuffers } from './mesh';
import { loadOcct } from './occt/load';
import { type KernelApi, KernelService } from './service';

const service = new KernelService(() =>
  loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
);

/** The service, with mesh buffers transferred instead of copied. */
const api: KernelApi = {
  init: () => service.init(),
  debugTestPart: async () => {
    const part = await service.debugTestPart();
    return Comlink.transfer(part, meshBuffers(part.mesh));
  },
  debugCrash: () => service.debugCrash(),
  stats: () => service.stats(),
};

Comlink.expose(api);
