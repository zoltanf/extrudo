// Kernel Web Worker entry. Spawned by spawnBrowserKernel() (browser.ts).
import * as Comlink from 'comlink';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { loadOcct } from './occt/load';
import { KernelService } from './service';
import { workerApi } from './worker-api';

const service = new KernelService(() =>
  loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
);

Comlink.expose(workerApi(service));
