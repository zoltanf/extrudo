/**
 * The OpenSCAD compiler in Node (ADR-0071 §3): a `worker_threads` worker
 * (`node-worker.ts`) that compiles `dist/openscad.wasm` once and makes an
 * instance per compile. For the CLI and the kernel's tests:
 *
 *   new KernelService(loadOcct, { openscad: () => createNodeCompiler() })
 *
 * The worker is unreferenced while it waits, so it never keeps a process
 * alive on its own; `dispose()` stops it.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { type CompileReply, type SpawnWorker, WorkerCompiler } from './compiler';
import type { ScadCompiler, ScadLimits } from './index';

/** Where `pnpm openscad ensure` puts the build. */
export const OPENSCAD_DIST = fileURLToPath(new URL('../dist/', import.meta.url));

export function createNodeCompiler(limits: ScadLimits = {}): ScadCompiler {
  if (!existsSync(`${OPENSCAD_DIST}openscad.wasm`)) {
    throw new Error(
      `OpenSCAD's WASM is missing from ${OPENSCAD_DIST}: run \`pnpm openscad ensure\` (or \`pnpm wasm\`).`,
    );
  }
  const spawn: SpawnWorker = ({ reply, fail }) => {
    const worker = new Worker(new URL('./node-worker.ts', import.meta.url), {
      workerData: { dist: OPENSCAD_DIST },
    });
    worker.unref();
    worker.on('message', (message: CompileReply) => reply(message));
    worker.on('error', (error: Error) => fail(error.message));
    worker.on('exit', (code) => {
      if (code !== 0) fail(`the worker exited with code ${code}`);
    });
    return {
      post: (message) => worker.postMessage(message),
      busy: (busy) => (busy ? worker.ref() : worker.unref()),
      terminate: () => {
        worker.removeAllListeners();
        void worker.terminate();
      },
    };
  };
  return new WorkerCompiler(spawn, limits);
}
