/**
 * The FreeCAD importer's `ImportKernel` (ADR-0144 decision 2) on a throwaway
 * kernel worker started as an import kernel: the project's kernel entry
 * (`kernelWorker.ts`) under the name `IMPORT_KERNEL_WORKER_NAME`. It
 * runs inside the import's own worker (`fcstdWorker.ts`), so the kernel is a
 * nested worker: terminating the import's worker ends it too, however the
 * import ends. A kernel worker that dies fails the call in progress at once
 * rather than at the time budget.
 */
import type { ImportKernel, StoredShapeStep } from '@extrudo/fcstd';
import { connectKernelWorker, type KernelConnection } from '@extrudo/kernel';
import { IMPORT_KERNEL_WORKER_NAME } from './kernelNames';

export const IMPORT_KERNEL_DIED = 'the geometry kernel stopped';

function spawnImportKernel(): KernelConnection {
  return connectKernelWorker(
    new Worker(new URL('./kernelWorker.ts', import.meta.url), {
      type: 'module',
      name: IMPORT_KERNEL_WORKER_NAME,
    }),
  );
}

/** `spawn` stands in for the worker in tests. */
export function workerImportKernel(
  spawn: () => KernelConnection = spawnImportKernel,
): ImportKernel & { dispose(): void } {
  let connection: KernelConnection | undefined;
  let died: Promise<never> = new Promise(() => {});
  const start = () => {
    const c = spawn();
    connection = c;
    died = new Promise<never>((_, reject) => {
      c.onFatal((error) => reject(new Error(`${IMPORT_KERNEL_DIED}: ${error.message}`)));
    });
    // Nobody may be waiting when it dies.
    died.catch(() => {});
    return c;
  };
  return {
    storedShapeToStep: (text, chain): Promise<StoredShapeStep> => {
      const c = connection ?? start();
      return Promise.race([c.api.storedShapeToStep(text, [...chain]), died]);
    },
    restart: async () => {
      connection?.terminate();
      start();
    },
    dispose: () => {
      connection?.terminate();
      connection = undefined;
    },
  };
}
