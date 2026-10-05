/**
 * The OpenSCAD compiler in a browser (ADR-0071 §3): a module worker nested in
 * the kernel worker (`browser-worker.ts`), which compiles `openscad.wasm`
 * once and makes an instance per compile. The kernel worker loads this module
 * with a dynamic `import()` the first time a design needs it
 * (`KernelApi.enableOpenscad`), so a design without a `.scad` import fetches
 * none of it.
 */
import { type CompileReply, type SpawnWorker, WorkerCompiler } from './compiler';
import type { ScadCompiler, ScadLimits } from './index';

export function createBrowserCompiler(limits: ScadLimits = {}): ScadCompiler {
  const spawn: SpawnWorker = ({ reply, fail }) => {
    const worker = new Worker(new URL('./browser-worker.ts', import.meta.url), {
      type: 'module',
      name: 'extrudo-openscad',
    });
    worker.addEventListener('message', (event: MessageEvent<CompileReply>) => reply(event.data));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      fail(event.message || 'the OpenSCAD worker failed');
    });
    return {
      post: (message) => worker.postMessage(message),
      busy: () => {},
      terminate: () => worker.terminate(),
    };
  };
  return new WorkerCompiler(spawn, limits);
}
