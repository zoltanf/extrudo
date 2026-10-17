import { Design } from '@extrudo/api';
import { describe, expect, it, vi } from 'vitest';
import {
  F3D_CRASH_TEXT,
  F3D_TIMEOUT_TEXT,
  type F3dWorkerLike,
  type F3dWorkerReply,
  type F3dWorkerRequest,
  workerImportRunner,
} from './f3dImport';

/** A stand-in for the worker: records what it was sent and whether it was terminated. */
function fakeWorker() {
  const sent: { request: F3dWorkerRequest; transfer: unknown }[] = [];
  const worker = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(request: F3dWorkerRequest, transfer: unknown) {
      sent.push({ request, transfer });
    },
    terminate() {
      this.terminated = true;
    },
    reply(data: F3dWorkerReply) {
      (this.onmessage as ((e: MessageEvent) => void) | null)?.({ data } as MessageEvent);
    },
    fail() {
      const event = { preventDefault: vi.fn() } as unknown as ErrorEvent;
      (this.onerror as ((e: ErrorEvent) => void) | null)?.(event);
      return event;
    },
  };
  return { worker: worker as typeof worker & F3dWorkerLike, sent };
}

const options = { id: 'doc-1', appVersion: '0.0.0' };

describe('the .f3d import worker client (ADR-0083, 2026-10-16)', () => {
  it('transfers the bytes, rebuilds the design from its document and terminates the worker', async () => {
    const { worker, sent } = fakeWorker();
    const run = workerImportRunner(() => worker, 1000);
    const bytes = new Uint8Array([1, 2, 3]);
    const pending = run(bytes, 'Bracket', options);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.request.name).toBe('Bracket');
    expect(sent[0]?.request.options).toEqual(options);
    expect(sent[0]?.transfer).toEqual([sent[0]?.request.bytes]);
    const doc = Design.create({ name: 'Bracket' }).toJSON();
    const preview = new Uint8Array([9]);
    worker.reply({
      result: {
        doc,
        report: { imported: ['Box1'], skipped: [], notes: [] },
        preview,
        steps: [{ record: 1, name: 'Body1', step: 'ISO-10303-21;' }],
        bodies: [{ record: 1, name: 'Body1' }],
      },
    });
    const result = await pending;
    expect(result.design).toBeInstanceOf(Design);
    expect(result.design.doc.name).toBe('Bracket');
    expect(result.report.imported).toEqual(['Box1']);
    expect(result.preview).toBe(preview);
    expect(result.steps?.[0]?.step).toBe('ISO-10303-21;');
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the importer's own message when it throws", async () => {
    const { worker } = fakeWorker();
    const pending = workerImportRunner(() => worker, 1000)(new Uint8Array(1), 'x', options);
    worker.reply({ error: 'Not a ZIP archive (no end of central directory).' });
    await expect(pending).rejects.toThrow('Not a ZIP archive');
    expect(worker.terminated).toBe(true);
  });

  it('turns a worker that dies into a message, not an uncaught error', async () => {
    const { worker } = fakeWorker();
    const pending = workerImportRunner(() => worker, 1000)(new Uint8Array(1), 'x', options);
    const event = worker.fail();
    await expect(pending).rejects.toThrow(F3D_CRASH_TEXT);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });

  it('stops an import over the time budget and ignores a late answer', async () => {
    vi.useFakeTimers();
    try {
      const { worker } = fakeWorker();
      const pending = workerImportRunner(() => worker, 1000)(new Uint8Array(1), 'x', options);
      const settled = expect(pending).rejects.toThrow(F3D_TIMEOUT_TEXT);
      vi.advanceTimersByTime(999);
      expect(worker.terminated).toBe(false);
      vi.advanceTimersByTime(1);
      await settled;
      expect(worker.terminated).toBe(true);
      expect(worker.onmessage).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
