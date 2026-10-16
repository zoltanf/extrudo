// The `.f3d` import's module worker (ADR-0083, 2026-10-16): unzip, decode, map
// and the B-rep writer run here, off the UI thread, so a slow or hostile file
// can't freeze the tab and the client can terminate it (`f3dImport.ts`). It
// takes one request and answers once; the client then terminates it.
import { importF3d } from '@extrudo/f3d';
import { F3D_MEMORY_TEXT, type F3dWorkerReply, type F3dWorkerRequest } from './f3dImport';

self.onmessage = async ({ data }: MessageEvent<F3dWorkerRequest>) => {
  // The solver vets the file's sketch constraints and dimensions; without it
  // the sketches still come over, unconstrained.
  const solver = await import('@extrudo/sketch/browser')
    .then((m) => m.loadSketchSolver())
    .catch(() => undefined);
  let reply: F3dWorkerReply;
  try {
    const { design, ...rest } = importF3d(new Uint8Array(data.bytes), data.name, {
      ...data.options,
      bodies: true,
      ...(solver ? { solver } : {}),
    });
    // A Design is a class: the document crosses as JSON, the rest is plain data.
    reply = { result: { ...rest, doc: design.toJSON() } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply = {
      error:
        error instanceof RangeError && /allocation failed/i.test(message)
          ? F3D_MEMORY_TEXT
          : message,
    };
  } finally {
    // A solver that failed may fail to dispose too: that must not lose the import.
    try {
      solver?.dispose();
    } catch {}
  }
  self.postMessage(reply);
};
