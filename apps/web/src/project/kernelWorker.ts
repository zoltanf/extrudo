// The kernel Web Worker of a project (P5-02, ADR-0070 §2): the kernel's own
// worker (`serveKernel`) plus the script runner, which `@extrudo/kernel` may
// not import. The runner and its QuickJS WebAssembly load only when a design
// with a Script feature first recomputes (`KernelApi.enableScripts`), as
// manifold-3d loads only for a mesh body.
//
// The FreeCAD import starts the same entry as its own throwaway kernel
// (ADR-0144 decision 5; one bundle, not two), under the worker name
// `IMPORT_KERNEL_WORKER_NAME`: only then is it an import kernel, which reads
// a file's B-rep text, and it has no script runner. A project's kernel is
// never started with that name (`spawnKernel.ts`).
import { serveKernel } from '@extrudo/kernel/worker';
import { IMPORT_KERNEL_WORKER_NAME } from './kernelNames';

serveKernel(
  self.name === IMPORT_KERNEL_WORKER_NAME
    ? { importKernel: true }
    : {
        scripts: async () => {
          const start = performance.now();
          const host = await (await import('@extrudo/script/browser')).loadBrowserScriptHost();
          performance.measure('extrudo-script-host-load', { start, end: performance.now() });
          return host;
        },
      },
);
