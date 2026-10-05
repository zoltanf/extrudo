// The dialog debug page's kernel worker (`#/debug/dialog`, P2-05, ADR-0027):
// the app's kernel plus the engine's test features (`recompute/testing.ts`),
// so the feature dialog framework can be tried and tested end to end before
// any real feature has a dialog. Spawned by spawnDebugKernel() (browser.ts);
// the app's own worker never registers these types.
import * as Comlink from 'comlink';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import wasmUrl from '../occt/dist/extrudo_occt_single.wasm?url';
import { loadOcct } from './occt/load';
import { testFeatures } from './recompute/testing';
import { KernelService } from './service';
import { workerApi } from './worker-api';

const service = new KernelService(
  () => loadOcct({ wasmUrl, log: (line) => console.debug('[occt]', line) }),
  { features: testFeatures().registry, manifold: { wasmUrl: manifoldWasmUrl } },
);

Comlink.expose(workerApi(service));
