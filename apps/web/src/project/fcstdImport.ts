/**
 * Runs the FreeCAD importer in its own module worker (`fcstdWorker.ts`,
 * ADR-0144 decision 9), as `f3dImport.ts` does for `.f3d`: the bytes go over
 * (transferred), progress and then the result come back, and the worker is
 * terminated, which ends the import's own kernel worker with it. A thrown
 * error, a worker that dies and an import over the time budget all reject
 * with plain words.
 */
import { Design } from '@extrudo/api';
import type { AttachmentId, ExtrudoDocument } from '@extrudo/core';
import type { FcstdImportReport } from '@extrudo/fcstd';

/**
 * How long the whole import may run before the worker is stopped: the
 * importer's own budget (`IMPORT_TIMEOUT_MS`, ten minutes, which leaves the
 * shapes it hasn't reached out with a line) and a minute for the reader and
 * the kernel's start.
 */
export const FCSTD_IMPORT_TIMEOUT_MS = 11 * 60_000;

export interface FcstdImportOptions {
  id: string;
  appVersion: string;
}

/** What the import gives the app: the design, its files' bytes and the report. */
export interface FcstdImported {
  design: Design;
  files: ReadonlyMap<AttachmentId, Uint8Array>;
  report: FcstdImportReport;
}

/** The import, as `importFcstdFile` calls it (a parameter, so its tests can run it inline). */
export type FcstdImportRunner = (
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  options: FcstdImportOptions,
  onProgress?: (done: number, total: number) => void,
) => Promise<FcstdImported>;

export interface FcstdWorkerRequest {
  bytes: ArrayBuffer;
  name: string;
  options: FcstdImportOptions;
}

export type FcstdWorkerReply =
  | { progress: [done: number, total: number] }
  | {
      result: {
        doc: ExtrudoDocument;
        files: [AttachmentId, Uint8Array][];
        report: FcstdImportReport;
      };
    }
  | { error: string };

export type FcstdWorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

export const FCSTD_TIMEOUT_TEXT =
  'The import took too long and was stopped. The file may be too complex for Extrudo to read.';
export const FCSTD_MEMORY_TEXT =
  'This FreeCAD file needs more memory than the browser gives the importer.';
export const FCSTD_CRASH_TEXT =
  'The importer stopped unexpectedly while reading this file (it may have run out of memory).';

function spawnFcstdWorker(): FcstdWorkerLike {
  return new Worker(new URL('./fcstdWorker.ts', import.meta.url), {
    type: 'module',
    name: 'extrudo-fcstd',
  });
}

/** The worker client. `spawn` and `timeoutMs` stand in for the real worker and budget in tests. */
export function fcstdImportRunner(
  spawn: () => FcstdWorkerLike = spawnFcstdWorker,
  timeoutMs = FCSTD_IMPORT_TIMEOUT_MS,
): FcstdImportRunner {
  return (bytes, name, options, onProgress) =>
    new Promise<FcstdImported>((resolve, reject) => {
      const worker = spawn();
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        settle();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error(FCSTD_TIMEOUT_TEXT))),
        timeoutMs,
      );
      worker.onmessage = ({ data }: MessageEvent<FcstdWorkerReply>) => {
        if ('progress' in data) {
          onProgress?.(...data.progress);
          return;
        }
        finish(() => {
          if ('error' in data) return reject(new Error(data.error));
          const { doc, files, report } = data.result;
          try {
            resolve({ design: Design.from(doc), files: new Map(files), report });
          } catch (error) {
            reject(error);
          }
        });
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish(() => reject(new Error(FCSTD_CRASH_TEXT)));
      };
      const request: FcstdWorkerRequest = { bytes: bytes.buffer, name, options };
      worker.postMessage(request, [bytes.buffer]);
    });
}
