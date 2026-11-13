// The FreeCAD import's module worker (P6-25 S3, ADR-0144 decision 9): the
// reader and the mapper run here, off the UI thread, and the import's own
// kernel runs in a worker this one starts (`importKernel.ts`), so terminating
// this worker ends both. It takes one request and answers once; the client
// (`fcstdImport.ts`) then terminates it.
import { clip, FcstdFormatError, importFcstd } from '@extrudo/fcstd';
import { FCSTD_MEMORY_TEXT, type FcstdWorkerReply, type FcstdWorkerRequest } from './fcstdImport';
import { workerImportKernel } from './importKernel';

const post = (reply: FcstdWorkerReply, transfer: Transferable[] = []) =>
  self.postMessage(reply, { transfer });

self.onmessage = async ({ data }: MessageEvent<FcstdWorkerRequest>) => {
  const kernel = workerImportKernel();
  // The solver vets the sketches' constraints (S4); without it the sketches
  // come in with none, which is still an import.
  const solver = await import('@extrudo/sketch/browser')
    .then((m) => m.loadSketchSolver())
    .catch(() => undefined);
  try {
    const { design, files, report } = await importFcstd(new Uint8Array(data.bytes), data.name, {
      ...data.options,
      kernel,
      ...(solver ? { solver } : {}),
      onProgress: (done, total) => post({ progress: [done, total] }),
    });
    const list = [...files];
    post(
      { result: { doc: design.toJSON(), files: list, report } },
      list.map(([, bytes]) => bytes.buffer as ArrayBuffer),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The message may quote the file: cut to the length the report allows a detail.
    post({
      error: clip(
        error instanceof RangeError && /allocation failed/i.test(message)
          ? FCSTD_MEMORY_TEXT
          : error instanceof FcstdFormatError
            ? `This file can't be read as a FreeCAD file: ${message}`
            : message,
      ),
    });
  } finally {
    kernel.dispose();
    // A solver that failed may fail to dispose too: that must not lose the import.
    try {
      solver?.dispose();
    } catch {}
  }
};
