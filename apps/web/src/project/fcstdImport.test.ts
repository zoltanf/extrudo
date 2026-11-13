import { Design } from '@extrudo/api';
import type { FcstdImportReport } from '@extrudo/fcstd';
import { describe, expect, it, vi } from 'vitest';
import {
  FCSTD_CRASH_TEXT,
  FCSTD_TIMEOUT_TEXT,
  type FcstdWorkerLike,
  type FcstdWorkerReply,
  type FcstdWorkerRequest,
  fcstdImportRunner,
} from './fcstdImport';

/** A stand-in for the worker: records what it was sent and whether it was terminated. */
function fakeWorker() {
  const sent: { request: FcstdWorkerRequest; transfer: unknown }[] = [];
  const worker = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(request: FcstdWorkerRequest, transfer: unknown) {
      sent.push({ request, transfer });
    },
    terminate() {
      this.terminated = true;
    },
    reply(data: FcstdWorkerReply) {
      (this.onmessage as ((e: MessageEvent) => void) | null)?.({ data } as MessageEvent);
    },
    fail() {
      const event = { preventDefault: vi.fn() } as unknown as ErrorEvent;
      (this.onerror as ((e: ErrorEvent) => void) | null)?.(event);
      return event;
    },
  };
  return { worker: worker as typeof worker & FcstdWorkerLike, sent };
}

const options = { id: 'doc-1', appVersion: '0.0.0' };
const report: FcstdImportReport = {
  shapes: [],
  leftOut: [],
  finalShapes: 0,
  problems: [],
  linkArrays: [],
  restarts: 0,
  bodies: [],
};

describe('the FreeCAD import worker client (ADR-0144 decision 9)', () => {
  it('transfers the bytes, passes progress on, rebuilds the design and terminates the worker', async () => {
    const { worker, sent } = fakeWorker();
    const progress: [number, number][] = [];
    const run = fcstdImportRunner(() => worker, 1000);
    const pending = run(new Uint8Array([1, 2, 3]), 'Bracket', options, (done, total) =>
      progress.push([done, total]),
    );
    expect(sent[0]?.request.name).toBe('Bracket');
    expect(sent[0]?.request.options).toEqual(options);
    expect(sent[0]?.transfer).toEqual([sent[0]?.request.bytes]);
    worker.reply({ progress: [1, 2] });
    worker.reply({ progress: [2, 2] });
    expect(worker.terminated).toBe(false);
    const doc = Design.create({ name: 'Bracket' }).toJSON();
    const file = new Uint8Array([7]);
    worker.reply({ result: { doc, files: [['att-1' as never, file]], report } });
    const result = await pending;
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(result.design.toJSON().name).toBe('Bracket');
    expect([...result.files]).toEqual([['att-1', file]]);
    expect(result.report).toEqual(report);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the worker's error, a crash or the time budget, and terminates it", async () => {
    const failing = fakeWorker();
    const a = fcstdImportRunner(() => failing.worker, 1000)(new Uint8Array(1), 'A', options);
    failing.worker.reply({ error: "This file can't be read as a FreeCAD file: Bad ZIP." });
    await expect(a).rejects.toThrow(/can't be read as a FreeCAD file/);
    expect(failing.worker.terminated).toBe(true);

    const crashing = fakeWorker();
    const b = fcstdImportRunner(() => crashing.worker, 1000)(new Uint8Array(1), 'B', options);
    const event = crashing.worker.fail();
    await expect(b).rejects.toThrow(FCSTD_CRASH_TEXT);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(crashing.worker.terminated).toBe(true);

    const slow = fakeWorker();
    const c = fcstdImportRunner(() => slow.worker, 10)(new Uint8Array(1), 'C', options);
    await expect(c).rejects.toThrow(FCSTD_TIMEOUT_TEXT);
    expect(slow.worker.terminated).toBe(true);
  });
});
