/**
 * The FreeCAD importer's `ImportKernel` (ADR-0144 decision 2) on a throwaway
 * kernel worker started as an import kernel: the project's kernel entry
 * (`kernelWorker.ts`) under the name `IMPORT_KERNEL_WORKER_NAME`. It
 * runs inside the import's own worker (`fcstdWorker.ts`), so the kernel is a
 * nested worker: terminating the import's worker ends it too, however the
 * import ends. A kernel worker that dies fails the call in progress at once
 * rather than at the time budget. The history walk's rebuilds (S5) go
 * through the kernel's `importRebuilder`, one per worker, so a fresh kernel
 * after a restart is sent the files again and recomputes from nothing.
 * The dress-ups' matching (S6) describes a stored shape and the last
 * rebuild's bodies and takes references with the kernel's `importReferences`,
 * the app's own call for a picked edge.
 */

import type { BodyId } from '@extrudo/core';
import type { ImportKernel, StoredShapeStep } from '@extrudo/fcstd';
import {
  connectKernelWorker,
  type ImportRebuilder,
  importRebuilder,
  importReferences,
  type KernelConnection,
} from '@extrudo/kernel';
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
  let rebuilder: ImportRebuilder | undefined;
  let died: Promise<never> = new Promise(() => {});
  const start = () => {
    const c = spawn();
    connection = c;
    rebuilder = importRebuilder(c.api);
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
    measureStoredShape: (text, chain) => {
      const c = connection ?? start();
      return Promise.race([c.api.measureStoredShape(text, [...chain]), died]);
    },
    rebuild: (doc, files, skip) => {
      if (!connection) start();
      return Promise.race([(rebuilder as ImportRebuilder).rebuild(doc, files, skip), died]);
    },
    describeStoredShape: (text, chain, ask) => {
      const c = connection ?? start();
      return Promise.race([
        c.api.describeStoredShape(text, [...chain], {
          edges: [...ask.edges],
          faces: [...ask.faces],
        }),
        died,
      ]);
    },
    describeBodies: (bodies, near) => {
      const c = connection ?? start();
      return Promise.race([
        c.api.describeBodies(bodies as BodyId[], { points: [...near.points], radius: near.radius }),
        died,
      ]);
    },
    references: (items) => {
      const c = connection ?? start();
      return Promise.race([importReferences(c.api, items), died]);
    },
    restart: async () => {
      connection?.terminate();
      start();
    },
    dispose: () => {
      connection?.terminate();
      connection = undefined;
      rebuilder = undefined;
    },
  };
}
