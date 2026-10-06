import { connectKernelWorker, type KernelConnection } from '@extrudo/kernel';

/**
 * Starts a project's kernel in its own module worker (`kernelWorker.ts`): the
 * kernel with the script runner (P5-02, ADR-0070 §2). Pass it to the
 * `Recomputer` as its `spawn`.
 */
export function spawnProjectKernel(): KernelConnection {
  return connectKernelWorker(
    new Worker(new URL('./kernelWorker.ts', import.meta.url), {
      type: 'module',
      name: 'extrudo-kernel',
    }),
  );
}
