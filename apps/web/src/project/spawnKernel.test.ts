/**
 * The kernel pool (ADR-0102 §8): a prewarmed spare is handed to the first
 * spawn, a dead spare is dropped, and a failed `init` is swallowed. No worker
 * here: the fake `make` stands in for `startWorker`.
 */

import type { KernelConnection } from '@extrudo/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernelPool, prewarmProjectKernel } from './spawnKernel';

function fakeConnection(
  init: ReturnType<typeof vi.fn> = vi.fn(async () => ({ initMs: 1, heapBytes: 0 })),
) {
  const fatal: Array<(error: Error) => void> = [];
  const connection = {
    api: { init },
    terminate: vi.fn(),
    onFatal: vi.fn((listener: (error: Error) => void) => {
      fatal.push(listener);
    }),
  };
  return {
    connection: connection as unknown as KernelConnection,
    fatal,
    terminate: connection.terminate,
    onFatal: connection.onFatal,
    init,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createKernelPool', () => {
  it('spawns without a spare, once per spawn', () => {
    const make = vi.fn(() => fakeConnection().connection);
    const pool = createKernelPool(make);
    const first = pool.spawn();
    const second = pool.spawn();
    expect(make).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });

  it('prewarms one spare: a second prewarm does nothing', async () => {
    const first = fakeConnection();
    const make = vi.fn(() => first.connection);
    const pool = createKernelPool(make);
    pool.prewarm();
    pool.prewarm();
    expect(make).toHaveBeenCalledTimes(1);
    expect(first.onFatal).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(first.init).toHaveBeenCalledOnce());
  });

  it('spawn takes the spare once, then makes its own', () => {
    const spare = fakeConnection();
    const next = fakeConnection();
    const make = vi
      .fn<() => KernelConnection>()
      .mockReturnValueOnce(spare.connection)
      .mockReturnValueOnce(next.connection);
    const pool = createKernelPool(make);
    pool.prewarm();
    expect(pool.spawn()).toBe(spare.connection);
    expect(make).toHaveBeenCalledTimes(1);
    expect(pool.spawn()).toBe(next.connection);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('drops a spare that dies before it is taken, and makes a fresh one', () => {
    const spare = fakeConnection();
    const next = fakeConnection();
    const make = vi
      .fn<() => KernelConnection>()
      .mockReturnValueOnce(spare.connection)
      .mockReturnValueOnce(next.connection);
    const pool = createKernelPool(make);
    pool.prewarm();
    spare.fatal[0]!(new Error('the worker died'));
    expect(spare.terminate).toHaveBeenCalledOnce();
    expect(pool.spawn()).toBe(next.connection);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('a fatal after the spare was taken does not terminate it', () => {
    const spare = fakeConnection();
    const make = vi.fn(() => spare.connection);
    const pool = createKernelPool(make);
    pool.prewarm();
    const taken = pool.spawn();
    spare.fatal[0]!(new Error('late death'));
    expect(spare.terminate).not.toHaveBeenCalled();
    expect(taken).toBe(spare.connection);
  });

  it('a rejecting init during prewarm is swallowed, and spawn still returns the spare', async () => {
    const init = vi.fn(async () => {
      throw new Error('the WASM failed to compile');
    });
    const spare = fakeConnection(init);
    const make = vi.fn(() => spare.connection);
    const pool = createKernelPool(make);
    pool.prewarm();
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
    expect(pool.spawn()).toBe(spare.connection);
  });

  it('prewarmProjectKernel does nothing where Worker is undefined', () => {
    expect(() => prewarmProjectKernel()).not.toThrow();
  });
});
