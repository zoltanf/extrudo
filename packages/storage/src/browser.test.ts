import { afterEach, describe, expect, it, vi } from 'vitest';
import { webLock } from './browser';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webLock (P3-13)', () => {
  it('asks the Web Locks API for the named lock', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { locks: { request } });
    const lock = webLock();
    expect(await lock('extrudo:versions:p1', async () => 42)).toBe(42);
    expect(request).toHaveBeenCalledWith('extrudo:versions:p1', expect.any(Function));
  });

  it('holds within the page where the API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const lock = webLock();
    const order: string[] = [];
    const slow = lock('x', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
    });
    const fast = lock('x', async () => {
      order.push('second');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
  });
});
