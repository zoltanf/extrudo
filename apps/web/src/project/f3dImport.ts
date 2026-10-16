/**
 * Runs the `.f3d` importer in its own module worker (`f3dWorker.ts`, ADR-0083,
 * 2026-10-16): the bytes go over (transferred), the import result comes back,
 * and the worker is terminated. A thrown error, a worker that dies and an
 * import over the time budget all reject with plain words.
 */
import { Design } from '@extrudo/api';
import type { ExtrudoDocument } from '@extrudo/core';
import type { ImportResult } from '@extrudo/f3d';

/**
 * How long an import may run before it is stopped. On the 250-file corpus the
 * slowest import (unzip, decode, map and the B-rep writer, with the solver)
 * took 5.2 s on the Ubuntu dev machine and the 95th percentile 0.8 s; this is
 * about six times the slowest.
 */
export const F3D_IMPORT_TIMEOUT_MS = 30_000;

export interface F3dImportOptions {
  id: string;
  appVersion: string;
}

/** The import, as `importF3dFile` calls it (a parameter, so its tests can run it inline). */
export type ImportRunner = (
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  options: F3dImportOptions,
) => Promise<ImportResult>;

/** What the client sends the worker. */
export interface F3dWorkerRequest {
  bytes: ArrayBuffer;
  name: string;
  options: F3dImportOptions;
}

/** What the worker answers: the result with the design as its document, or the error's message. */
export type F3dWorkerReply =
  | { result: Omit<ImportResult, 'design'> & { doc: ExtrudoDocument } }
  | { error: string };

/** What the client needs of a `Worker` (a fake one in tests). */
export type F3dWorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

export const F3D_TIMEOUT_TEXT =
  'The import took too long and was stopped. The file may be too complex for Extrudo to read.';
export const F3D_MEMORY_TEXT =
  'This .f3d file needs more memory than the browser gives the importer.';
export const F3D_CRASH_TEXT =
  'The importer stopped unexpectedly while reading this file (it may have run out of memory).';

function spawnF3dWorker(): F3dWorkerLike {
  return new Worker(new URL('./f3dWorker.ts', import.meta.url), {
    type: 'module',
    name: 'extrudo-f3d',
  });
}

/** The worker client. `spawn` and `timeoutMs` stand in for the real worker and budget in tests. */
export function workerImportRunner(
  spawn: () => F3dWorkerLike = spawnF3dWorker,
  timeoutMs = F3D_IMPORT_TIMEOUT_MS,
): ImportRunner {
  return (bytes, name, options) =>
    new Promise<ImportResult>((resolve, reject) => {
      const worker = spawn();
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        settle();
      };
      const timer = setTimeout(() => finish(() => reject(new Error(F3D_TIMEOUT_TEXT))), timeoutMs);
      worker.onmessage = ({ data }: MessageEvent<F3dWorkerReply>) =>
        finish(() => {
          if ('error' in data) return reject(new Error(data.error));
          const { doc, ...rest } = data.result;
          try {
            resolve({ ...rest, design: Design.from(doc) });
          } catch (error) {
            reject(error);
          }
        });
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish(() => reject(new Error(F3D_CRASH_TEXT)));
      };
      const request: F3dWorkerRequest = { bytes: bytes.buffer, name, options };
      worker.postMessage(request, [bytes.buffer]);
    });
}
