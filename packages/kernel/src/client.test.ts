// Crash recovery (NFR-03): a WASM abort must not take the app down. The kernel
// runs in-process here; the browser path (a real worker) is covered by the E2E
// test in e2e/kernel.spec.ts.
import { describe, expect, it } from 'vitest';
import { KernelClient, type KernelConnection, type KernelStatus } from './client';
import { loadOcct } from './occt/load';
import { type KernelApi, KernelCrashError, KernelService } from './service';

function inProcess(): KernelConnection {
  const service = new KernelService(() => loadOcct());
  return { api: service, terminate: () => {}, onFatal: () => {} };
}

const until = async (condition: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('KernelClient', () => {
  it('restarts the kernel after a WASM abort, and the next call works', {
    timeout: 30_000,
  }, async () => {
    const statuses: KernelStatus[] = [];
    const restarts: number[] = [];
    const client = new KernelClient(inProcess, {
      onStatus: (s) => statuses.push(s),
      onRestart: (n) => restarts.push(n),
    });

    await client.start();
    expect((await client.call((k) => k.debugTestPart())).valid).toBe(true);

    await expect(client.call((k) => k.debugCrash())).rejects.toThrow(KernelCrashError);
    await until(() => client.status === 'ready');

    expect(client.restarts).toBe(1);
    expect(restarts).toEqual([1]);
    expect(statuses).toEqual(['starting', 'ready', 'restarting', 'ready']);
    expect((await client.call((k) => k.debugTestPart())).valid).toBe(true);
  });

  it('rejects pending calls when the worker dies outside a call', async () => {
    let fatal: ((error: Error) => void) | undefined;
    let spawned = 0;
    const hanging: KernelApi = {
      init: async () => ({ initMs: 0, heapBytes: 0 }),
      debugTestPart: () => new Promise(() => {}),
      debugCrash: async () => {},
      stats: async () => ({ liveShapes: 0, heapTop: 0, heapBytes: 0 }),
    };
    const client = new KernelClient(() => {
      spawned++;
      return { api: hanging, terminate: () => {}, onFatal: (l) => (fatal = l) };
    });
    await client.start();
    const call = client.call((k) => k.debugTestPart());
    await new Promise((r) => setTimeout(r, 0)); // let the call reach the worker
    fatal?.(new Error('worker error'));
    await expect(call).rejects.toThrow(KernelCrashError);
    await until(() => client.status === 'ready');
    expect(spawned).toBe(2);
  });

  it('gives up after too many crashes in a row', async () => {
    const crashing: KernelApi = {
      init: async () => ({ initMs: 0, heapBytes: 0 }),
      debugTestPart: async () => {
        throw new KernelCrashError('boom');
      },
      debugCrash: async () => {},
      stats: async () => ({ liveShapes: 0, heapTop: 0, heapBytes: 0 }),
    };
    const client = new KernelClient(
      () => ({ api: crashing, terminate: () => {}, onFatal: () => {} }),
      { maxRestarts: 2 },
    );
    for (let i = 0; i < 3; i++) {
      await expect(client.call((k) => k.debugTestPart())).rejects.toThrow(KernelCrashError);
    }
    expect(client.status).toBe('failed');
    await expect(client.call((k) => k.stats())).rejects.toThrow(/keeps stopping/);
  });
});
