// The kernel Web Worker of a project (P5-02, ADR-0070 §2): the kernel's own
// worker (`serveKernel`) plus the script runner, which `@extrudo/kernel` may
// not import. The runner and its QuickJS WebAssembly load only when a design
// with a Script feature first recomputes (`KernelApi.enableScripts`), as
// manifold-3d loads only for a mesh body.
import { serveKernel } from '@extrudo/kernel/worker';

serveKernel({
  scripts: async () => {
    const start = performance.now();
    const host = await (await import('@extrudo/script/browser')).loadBrowserScriptHost();
    performance.measure('extrudo-script-host-load', { start, end: performance.now() });
    return host;
  },
});
